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
  RecordKey,
  Snapshot,
} from '../../contract/records/capabilities.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { FeasibilityOwners } from '../../contract/ports/render-jobs.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { json } from '../../contract/schemas.js';
import { authoringFailure } from '../../contract/errors.js';

/**
 * Binds feasibility to the real producer. `check` fails with `constraint-conflict` at the
 * producer's path when a changed collection cannot be rendered (producer failure kept as
 * source). Reader and job failures pass through unchanged. No partial preview is returned.
 */
export function createFeasibility(owners: FeasibilityOwners): Feasibility {
  return { check: (candidate, changed, preview) => check(candidate, changed, preview, owners) };
}
/** Validate changed collection geometry only; catalog/preset organisation alone creates no new scene to solve. */
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
  return { ok: true, value: report(documents.value, preview) };
}
/** Preserve failure while accumulating complete changed diagrams; no partial preview is admitted. */
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
/** Geometry failure is mandatory even when callers did not request a visual preview. */
async function render(
  collection: Collection,
  view: WorkspaceContents,
  owners: FeasibilityOwners,
): Promise<AuthoringResult<RenderDocument>> {
  const job = owners.jobs.create(
    collection,
    view,
    null,
    `admission:${collection.id}:${collection.revision}`,
  );
  if (!job.ok) return job;
  const result = await owners.producer.produce(job.value, new AbortController().signal);
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
/** Preview serialization is separate from mandatory geometry checks; an apply never returns an unused image payload. */
function report(
  documents: readonly RenderDocument[],
  preview: boolean,
): FeasibilityReport {
  return {
    warnings: warnings(documents),
    diff: json.parse(
      documents.map((item) => ({
        collection: item.collection.id,
        adjustments: item.scene.adjustments,
      })),
    ),
    preview: preview ? json.parse(JSON.parse(JSON.stringify(documents))) : null,
  };
}
/** Crossing warnings remain warnings in the result envelope, with labelled correction targets and no permission to violate constraints. */
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
