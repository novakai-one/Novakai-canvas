/*
 * Why this file exists
 *
 * A change can pass every rule and still be impossible to draw. So before Authoring saves a change,
 * it asks whether each changed collection can still be laid out ("feasibility"). For example,
 * `pnpm canvas preview` on a DSL change lays out the changed collection and warns if wires cross.
 *
 * This file answers that question for Authoring. It renders each changed collection and passes on
 * its routing warnings, each node or wire Layout had to nudge from where it was asked to go, and
 * the drawn result when a preview is asked for. It never saves anything.
 */
import type {
  AuthoringDiagnostic,
  AuthoringResult,
  Collection,
  Feasibility,
  FeasibilityReport,
  Json,
  RecordKey,
  SceneWarning,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type { DiagramProducer, RenderJobs } from '../../contract/ports/rendering.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { json } from '../../contract/schemas.js';
import type { Diagnostic } from '../../contract/errors.js';
import { authoringFailure, success } from '../../contract/errors.js';

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
 * answers its routing warnings, each node or wire Layout had to nudge (its box or route before and
 * after, and why), and the drawn result when a preview is asked for.
 * Mistakes: `constraint-conflict` when a collection can't be rendered or the request is cancelled,
 * `corrupt-record` when the result isn't JSON. The reader's and job builder's pass through.
 */
export function createFeasibility(dependencies: FeasibilityDependencies): Feasibility {
  return {
    check: (candidate, changed, previewAsked) =>
      checkFeasibility(candidate, changed, previewAsked, dependencies),
  };
}

/** The drawn documents so far, or the first mistake that stopped the drawing. */
type RenderedDocuments = AuthoringResult<readonly RenderDocument[]>;

/** One collection's layout nudges, as the report's `diff` lists them. */
interface CollectionAdjustments {
  readonly collection: string;
  readonly adjustments: RenderDocument['scene']['adjustments'];
}

/** What Authoring shows next to a routing warning: the wires can be improved, but need not be. */
const ROUTING_RECOVERY =
  'Optional routing improvement: adjust the named wires while retaining the diagram.';

/** Renders each changed collection of the candidate, then reports what Layout found. */
async function checkFeasibility(
  candidate: Snapshot,
  changed: readonly RecordKey[],
  previewAsked: boolean,
  dependencies: FeasibilityDependencies,
): Promise<AuthoringResult<FeasibilityReport>> {
  const documents = await renderChangedCollections(candidate, changed, dependencies);
  if (!documents.ok) {
    return documents;
  }
  return reportFeasibility(documents.value, previewAsked);
}

/** Reads the candidate, and renders the collections the change touched, one after another. */
async function renderChangedCollections(
  candidate: Snapshot,
  changed: readonly RecordKey[],
  dependencies: FeasibilityDependencies,
): Promise<RenderedDocuments> {
  const contents = dependencies.workspace.read(candidate);
  if (!contents.ok) {
    return contents;
  }
  const changedCollections = listChangedCollections(contents.value, changed);
  return renderInTurn(changedCollections, contents.value, dependencies);
}

/** Lists the collections whose record the change touched; other changed records are skipped. */
function listChangedCollections(
  contents: WorkspaceContents,
  changed: readonly RecordKey[],
): readonly Collection[] {
  const changedIds = listChangedCollectionIds(changed);
  return contents.collections.filter((collection) => changedIds.has(collection.id));
}

/** Collects the IDs of the changed collection records. */
function listChangedCollectionIds(changed: readonly RecordKey[]): ReadonlySet<string> {
  const collectionKeys = changed.filter((key) => key.kind === 'collection');
  const collectionIds = collectionKeys.map((key) => String(key.id));
  return new Set(collectionIds);
}

/** Renders the collections one after another, and stops at the first that can't be rendered. */
function renderInTurn(
  collections: readonly Collection[],
  contents: WorkspaceContents,
  dependencies: FeasibilityDependencies,
): Promise<RenderedDocuments> {
  const nothingRendered: Promise<RenderedDocuments> = Promise.resolve(success([]));
  // `renderNext` passes the first failure along unchanged, so later collections are not rendered.
  return collections.reduce(
    (earlier, collection) => renderNext(earlier, collection, contents, dependencies),
    nothingRendered,
  );
}

/** Waits for the earlier documents, then renders this collection and adds its document. */
async function renderNext(
  earlier: Promise<RenderedDocuments>,
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: FeasibilityDependencies,
): Promise<RenderedDocuments> {
  const rendered = await earlier;
  if (!rendered.ok) {
    return rendered;
  }
  const document = await renderCollection(collection, contents, dependencies);
  if (!document.ok) {
    return document;
  }
  const documents = [...rendered.value, document.value];
  return success(documents);
}

/** Builds the collection's render job and renders it, stopping when the request is cancelled. */
async function renderCollection(
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: FeasibilityDependencies,
): Promise<AuthoringResult<RenderDocument>> {
  const job = dependencies.jobs.create(collection, contents, 'change-check');
  if (!job.ok) {
    return job;
  }
  const document = await dependencies.producer.produce(job.value, dependencies.signal);
  if (!document.ok) {
    return unrenderableFailure(document.error);
  }
  return success(document.value);
}

/** Builds the report: the routing warnings, the layout nudges, and the preview when asked for. */
function reportFeasibility(
  documents: readonly RenderDocument[],
  previewAsked: boolean,
): AuthoringResult<FeasibilityReport> {
  const diff = listLayoutAdjustments(documents);
  if (!diff.ok) {
    return diff;
  }
  const preview = previewDocuments(documents, previewAsked);
  if (!preview.ok) {
    return preview;
  }
  const warnings = listRoutingWarnings(documents);
  return success({ warnings, diff: diff.value, preview: preview.value });
}

/** Lists each collection's layout nudges, checked as JSON. */
function listLayoutAdjustments(documents: readonly RenderDocument[]): AuthoringResult<Json> {
  const adjustments = documents.map(collectionAdjustments);
  return checkedJson(adjustments);
}

/** Pairs one collection's ID with the nudges Layout made to it. */
function collectionAdjustments(document: RenderDocument): CollectionAdjustments {
  return { collection: document.collection.id, adjustments: document.scene.adjustments };
}

/** Copies the documents as plain JSON when a preview was asked for, or gives `null`. */
function previewDocuments(
  documents: readonly RenderDocument[],
  previewAsked: boolean,
): AuthoringResult<Json | null> {
  if (!previewAsked) {
    return success(null);
  }
  return plainJsonCopy(documents);
}

/** Copies the documents the way `JSON.stringify` writes them, and checks the copy is JSON. */
function plainJsonCopy(documents: readonly RenderDocument[]): AuthoringResult<Json> {
  // `JSON.stringify` throws on a BigInt or a cycle; that becomes the same "not JSON" mistake.
  try {
    const text = JSON.stringify(documents);
    const copy: unknown = JSON.parse(text);
    return checkedJson(copy);
  } catch {
    return notJsonFailure();
  }
}

/** Checks a rendered value is JSON, and gives it back as JSON. */
function checkedJson(rendered: unknown): AuthoringResult<Json> {
  const checked = json.safeParse(rendered);
  if (!checked.success) {
    return notJsonFailure();
  }
  return success(checked.data);
}

/** Lists every routing warning of every drawn collection. */
function listRoutingWarnings(documents: readonly RenderDocument[]): readonly AuthoringDiagnostic[] {
  return documents.flatMap(collectionRoutingWarnings);
}

/** Lists one drawn collection's routing warnings, each placed at the collection's ID. */
function collectionRoutingWarnings(document: RenderDocument): readonly AuthoringDiagnostic[] {
  const collectionId = document.collection.id;
  return document.scene.warnings.map((warning) => routingWarning(collectionId, warning));
}

/** Turns one Layout warning into an Authoring warning that names the wires to adjust. */
function routingWarning(
  collectionId: string,
  warning: SceneWarning,
): AuthoringDiagnostic {
  return {
    code: 'constraint-conflict',
    path: collectionId,
    targets: [...warning.targets],
    message: warning.message,
    recovery: ROUTING_RECOVERY,
    traceId: null,
  };
}

/** Makes the mistake for a collection the renderer couldn't draw, keeping the renderer's own. */
function unrenderableFailure(producerFailure: Diagnostic): AuthoringResult<never> {
  return authoringFailure(
    'constraint-conflict',
    producerFailure.path,
    producerFailure.message,
    [],
    producerFailure,
  );
}

/** Makes the mistake for drawn output that isn't JSON. */
function notJsonFailure(): AuthoringResult<never> {
  return authoringFailure('corrupt-record', 'feasibility', 'Rendered documents are not JSON');
}
