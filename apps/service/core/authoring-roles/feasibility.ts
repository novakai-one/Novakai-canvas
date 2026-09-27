import { z } from 'zod';
import { failure } from '@novakai/canvas-authoring';
import type {
  Feasibility,
  FeasibilityReport,
  Snapshot,
  RecordKey,
  Result,
  Diagnostic,
} from '@novakai/canvas-authoring';
import type { Collection } from '@novakai/canvas-model';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { FeasibilityOwners } from '../../contract/ports/render-jobs.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
/** Geometry failure is mandatory even when callers did not request a visual preview. */
async function render(
  collection: Collection,
  view: WorkspaceContents,
  owners: FeasibilityOwners,
): Promise<Result<RenderDocument>> {
  const job = owners.jobs.create(
    collection,
    view,
    null,
    `admission:${collection.id}:${collection.revision}`,
  );
  if (!job.ok) return job;
  const result = await owners.producer.produce(job.value, new AbortController().signal);
  if (!result.ok)
    return failure(
      'constraint-conflict',
      result.error.path,
      result.error.message,
      [],
      result.error,
    );
  return result;
}
/** Preserve failure while accumulating complete changed diagrams; no partial preview is admitted. */
async function append(
  previous: Promise<Result<readonly RenderDocument[]>>,
  collection: Collection,
  view: WorkspaceContents,
  owners: FeasibilityOwners,
): Promise<Result<readonly RenderDocument[]>> {
  const result = await previous;
  if (!result.ok) return result;
  const next = await render(collection, view, owners);
  if (!next.ok) return next;
  return { ok: true, value: [...result.value, next.value] };
}
/** Crossing warnings remain warnings in the result envelope, with labelled correction targets and no permission to violate constraints. */
function warnings(documents: readonly RenderDocument[]): readonly Diagnostic[] {
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
/** Validate changed collection geometry only; catalog/preset organisation alone creates no new scene to solve. */
async function check(
  candidate: Snapshot,
  changed: readonly RecordKey[],
  preview: boolean,
  owners: FeasibilityOwners,
): Promise<Result<FeasibilityReport>> {
  const view = owners.workspace.read(candidate);
  if (!view.ok) return view;
  const ids = new Set(
    changed.filter((key) => key.kind === 'collection').map((key) => String(key.id)),
  );
  const collections = view.value.collections.filter((collection) => ids.has(collection.id));
  const documents = await collections.reduce(
    (previous, collection) => append(previous, collection, view.value, owners),
    Promise.resolve<Result<readonly RenderDocument[]>>({ ok: true, value: [] }),
  );
  if (!documents.ok) return documents;
  return { ok: true, value: report(documents.value, preview) };
}
/** Preview serialization is separate from mandatory geometry checks; an apply never returns an unused image payload. */
function report(
  documents: readonly RenderDocument[],
  preview: boolean,
): FeasibilityReport {
  return {
    warnings: warnings(documents),
    diff: z.json().parse(
      documents.map((item) => ({
        collection: item.collection.id,
        adjustments: item.scene.adjustments,
      })),
    ),
    preview: preview ? z.json().parse(JSON.parse(JSON.stringify(documents))) : null,
  };
}

/** Bind the real worker producer; Authoring still performs final conditional commit after every successful feasibility result. */
export function createFeasibility(owners: FeasibilityOwners): Feasibility {
  return { check: (candidate, changed, preview) => check(candidate, changed, preview, owners) };
}
