/*
 * Authoring's feasibility role: renders every changed collection of a candidate, turns routing
 * warnings into Authoring warnings and, when asked, returns the rendered documents as a preview.
 * Pure over the injected reader, job builder and producer. Authoring still performs the final
 * conditional commit after every successful check.
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
} from '../../contract/records/capabilities.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type { DiagramProducer, RenderJobs } from '../../contract/ports/rendering.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { json } from '../../contract/schemas.js';
import { andThen, authoringFailure, success } from '../../contract/errors.js';

/** What feasibility reads the candidate with, builds each job with and renders it with. */
export interface FeasibilityOwners {
  readonly workspace: WorkspaceReader;
  readonly jobs: RenderJobs;
  readonly producer: DiagramProducer;
  /** The request's cancellation; every feasibility render runs under it. */
  readonly signal: AbortSignal;
}

/**
 * Binds feasibility to the real producer. `check` fails with `constraint-conflict` at the
 * producer's path when a changed collection cannot be rendered (producer failure kept as
 * source), and `corrupt-record` at `feasibility` when a rendered document is not JSON. Reader and
 * job failures pass through unchanged. No partial preview is returned.
 */
export function createFeasibility(owners: FeasibilityOwners): Feasibility {
  return { check: (candidate, changed, preview) => check(candidate, changed, preview, owners) };
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
  owners: FeasibilityOwners,
): Promise<AuthoringResult<FeasibilityReport>> {
  const view = owners.workspace.read(candidate);
  if (!view.ok) return view;
  const ids = new Set(
    changed.filter((key) => key.kind === 'collection').map((key) => String(key.id)),
  );
  const collections = view.value.collections.filter((collection) => ids.has(collection.id));
  const documents = await collections.reduce(
    (previous, collection) => append(previous, collection, view.value, owners),
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
  owners: FeasibilityOwners,
): Promise<AuthoringResult<readonly RenderDocument[]>> {
  const result = await previous;
  if (!result.ok) return result;
  const next = await render(collection, view, owners);
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
  owners: FeasibilityOwners,
): Promise<AuthoringResult<RenderDocument>> {
  const job = owners.jobs.create(collection, view, 'admission');
  if (!job.ok) return job;
  const result = await owners.producer.produce(job.value, owners.signal);
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
 * The rendered documents as plain JSON when `preview` is true, otherwise `null`. Fails with
 * `corrupt-record` at `feasibility` when they are not JSON.
 */
function previewDocuments(
  documents: readonly RenderDocument[],
  preview: boolean,
): AuthoringResult<Json | null> {
  if (!preview) return success(null);
  const copied = json.safeParse(JSON.parse(JSON.stringify(documents)));
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
