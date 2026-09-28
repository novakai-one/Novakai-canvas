/*
 * Why this file exists
 *
 * A change can pass every rule and still be impossible to draw. So before Authoring saves a change,
 * it asks whether each changed collection can still be laid out ("feasibility"). For example,
 * `pnpm canvas preview` on a DSL change lays out the changed collection and warns if wires cross.
 *
 * This file answers that question for Authoring. It renders each changed collection and passes on
 * its routing warnings, which nodes and wires the layout moved, and the drawn result when a preview
 * is asked for. Each step answers a `Result` (contract/errors.ts); the first mistake stops the
 * check. It never saves anything.
 */
import type {
  AuthoringDiagnostic,
  AuthoringResult,
  Collection,
  Feasibility,
  FeasibilityReport,
  Json,
  RecordKey,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type { DiagramProducer, RenderJobs } from '../../contract/ports/rendering.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { json } from '../../contract/schemas.js';
import { andThen, authoringFailure, success } from '../../contract/errors.js';

/** What the layout check needs: a reader, a job builder, the renderer, and the request's signal. */
export interface FeasibilityDependencies {
  /** Reads the changed workspace into checked collections. */
  readonly workspace: WorkspaceReader;
  /** Builds the render job for one collection. */
  readonly jobs: RenderJobs;
  /** Renders one job into a laid-out document. */
  readonly producer: DiagramProducer;
  /** The request's cancellation. Every render here stops when it aborts. */
  readonly signal: AbortSignal;
}

/**
 * Builds Authoring's layout check (`Feasibility`). Its `check` renders each changed collection and
 * answers its routing warnings, which nodes and wires the layout moved (before and after), and the
 * drawn result when a preview is asked for.
 * Mistakes: `constraint-conflict` when a collection can't be rendered or the request is cancelled,
 * `corrupt-record` when the result isn't JSON. The reader's and job builder's pass through.
 */
export function createFeasibility(dependencies: FeasibilityDependencies): Feasibility {
  return {
    check: (candidate, changed, preview) => check(candidate, changed, preview, dependencies),
  };
}

/**
 * Renders each changed collection of the candidate in turn, then reports (see `report`). Other
 * changed records are not rendered. Fails with the first render failure (see `render`), or as
 * `report` fails. Reader failures pass through unchanged.
 */
async function check(
  candidate: Snapshot,
  changed: readonly RecordKey[],
  preview: boolean,
  dependencies: FeasibilityDependencies,
): Promise<AuthoringResult<FeasibilityReport>> {
  const view = dependencies.workspace.read(candidate);
  if (!view.ok) return view;
  const ids = new Set(
    changed.filter((key) => key.kind === 'collection').map((key) => String(key.id)),
  );
  const collections = view.value.collections.filter((collection) => ids.has(collection.id));
  const documents = await collections.reduce(
    (previous, collection) => append(previous, collection, view.value, dependencies),
    Promise.resolve<AuthoringResult<readonly RenderDocument[]>>({ ok: true, value: [] }),
  );
  if (!documents.ok) return documents;
  return report(documents.value, preview);
}

/**
 * One reduce step: waits for the earlier documents, then renders this collection and appends it.
 * An earlier failure passes through unchanged; a new one stops the run (see `render`).
 */
async function append(
  previous: Promise<AuthoringResult<readonly RenderDocument[]>>,
  collection: Collection,
  view: WorkspaceContents,
  dependencies: FeasibilityDependencies,
): Promise<AuthoringResult<readonly RenderDocument[]>> {
  const result = await previous;
  if (!result.ok) return result;
  const next = await render(collection, view, dependencies);
  if (!next.ok) return next;
  return { ok: true, value: [...result.value, next.value] };
}

/**
 * Builds the `admission` job for one collection and renders it under the request's signal,
 * preview or not. Fails with `constraint-conflict` at the producer's path when the producer cannot
 * render it or the request is cancelled (the producer's failure kept as source). Job failures pass
 * through unchanged.
 */
async function render(
  collection: Collection,
  view: WorkspaceContents,
  dependencies: FeasibilityDependencies,
): Promise<AuthoringResult<RenderDocument>> {
  const job = dependencies.jobs.create(collection, view, 'change-check');
  if (!job.ok) return job;
  const result = await dependencies.producer.produce(job.value, dependencies.signal);
  if (!result.ok)
    return authoringFailure(
      'constraint-conflict',
      result.error.path,
      result.error.message,
      [],
      result.error,
    );
  return result;
}

/**
 * The report: every routing warning, each collection's layout adjustments as the diff, and the
 * rendered documents as the preview only when `preview` is true. Fails with `corrupt-record` at
 * `feasibility` when the adjustments or the documents are not JSON.
 */
function report(
  documents: readonly RenderDocument[],
  preview: boolean,
): AuthoringResult<FeasibilityReport> {
  const diff = json.safeParse(
    documents.map((item) => ({
      collection: item.collection.id,
      adjustments: item.scene.adjustments,
    })),
  );
  if (!diff.success) return notJson();
  const shown = previewDocuments(documents, preview);
  return andThen(shown, (previewed) =>
    success({ warnings: warnings(documents), diff: diff.data, preview: previewed }),
  );
}

/**
 * The rendered documents as plain JSON when `preview` is true, otherwise `null`. Fails as
 * `plainCopy` fails.
 */
function previewDocuments(
  documents: readonly RenderDocument[],
  preview: boolean,
): AuthoringResult<Json | null> {
  if (!preview) return success(null);
  return plainCopy(documents);
}

/**
 * The documents as `JSON.stringify` writes them, read back and checked as JSON. Fails with
 * `corrupt-record` at `feasibility` when `JSON.stringify` throws (a BigInt or a cycle; caught
 * here) or the copy is not JSON.
 */
function plainCopy(documents: readonly RenderDocument[]): AuthoringResult<Json> {
  try {
    return checkedJson(JSON.parse(JSON.stringify(documents)));
  } catch {
    return notJson();
  }
}

/** The value checked as JSON. Fails with `corrupt-record` at `feasibility` when it is not JSON. */
function checkedJson(value: unknown): AuthoringResult<Json> {
  const copied = json.safeParse(value);
  if (!copied.success) return notJson();
  return success(copied.data);
}

/** The refusal for rendered output that is not JSON: `corrupt-record` at `feasibility`. */
function notJson(): AuthoringResult<never> {
  return authoringFailure('corrupt-record', 'feasibility', 'Rendered documents are not JSON');
}

/** Each routing warning as a `constraint-conflict` warning at its collection ID, naming the wires to adjust. Never fails. */
function warnings(documents: readonly RenderDocument[]): readonly AuthoringDiagnostic[] {
  return documents.flatMap((document) =>
    document.scene.warnings.map((item) => ({
      code: 'constraint-conflict' as const,
      path: document.collection.id,
      targets: [...item.targets],
      message: item.message,
      recovery: 'Optional routing improvement: adjust the named wires while retaining the diagram.',
      traceId: null,
    })),
  );
}
