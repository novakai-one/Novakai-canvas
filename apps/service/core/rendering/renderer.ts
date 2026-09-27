import type { Assets } from '@novakai/canvas-assets';
import type { Collection } from '@novakai/canvas-model';
import type { CollectionRenderer } from '../../contract/ports/collection-renderer.js';
import type { RenderJobs } from '../../contract/ports/render-jobs.js';
import type { DiagramProducer } from '../../contract/ports/rendering.js';
import type { ResourceSelector } from '../../contract/records/planning/planning.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { failure, type Result } from '../../contract/errors.js';
export interface CollectionRenderOwners {
  readonly assets: Assets;
  readonly jobs: RenderJobs;
  readonly producer: DiagramProducer;
  readonly resources: ResourceSelector;
}
/** Acquire a real byte lease before reading font/media payloads into an isolated worker. */
async function render(
  collection: Collection,
  workspace: WorkspaceContents,
  signal: AbortSignal,
  owners: CollectionRenderOwners,
): Promise<Result<RenderDocument>> {
  const resources = owners.resources.forCollection(collection, workspace);
  if (!resources.ok)
    return failure('unavailable', resources.error.path, resources.error.message, resources.error);
  const lease = owners.assets.acquire(resources.value);
  if (!lease.ok) return failure('unavailable', lease.error.path, lease.error.message, lease.error);
  try {
    return await produce(collection, workspace, signal, owners);
  } finally {
    lease.value.release();
  }
}
/** The renderer has no write authority; a stale read is discarded by the browser's requested-generation check. */
async function produce(
  collection: Collection,
  workspace: WorkspaceContents,
  signal: AbortSignal,
  owners: CollectionRenderOwners,
): Promise<Result<RenderDocument>> {
  const job = owners.jobs.create(
    collection,
    workspace,
    null,
    `read:${collection.id}:${collection.revision}`,
  );
  if (!job.ok) return failure('unavailable', job.error.path, job.error.message, job.error);
  return owners.producer.produce(job.value, signal);
}
/** Composed callers own retry and retain the previous readable scene when a required byte/provider is unavailable. */
export function createCollectionRenderer(owners: CollectionRenderOwners): CollectionRenderer {
  return {
    render: (collection, workspace, signal) => render(collection, workspace, signal, owners),
  };
}
