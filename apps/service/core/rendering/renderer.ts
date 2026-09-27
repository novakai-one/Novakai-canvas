/*
 * Renders one committed collection for a read: select the bytes it pins, hold them under an
 * Assets read lease, build its render job and produce the document. Pure over the injected owners.
 * The renderer has no write authority; callers own retry and keep their last readable scene on
 * any failure.
 */
import type { Assets, Collection } from '../../contract/records/capabilities.js';
import type {
  CollectionRenderer,
  DiagramProducer,
  RenderJobs,
} from '../../contract/ports/rendering.js';
import type { ResourceSelector } from '../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { failure, type Result } from '../../contract/errors.js';

/** The owners one collection read needs: byte selection and leases, job building and the producer. */
export interface CollectionRenderOwners {
  readonly assets: Pick<Assets, 'acquire'>;
  readonly jobs: RenderJobs;
  readonly producer: DiagramProducer;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
}

/** Binds collection reads to the given owners; `render` behaves as `render` below. */
export function createCollectionRenderer(owners: CollectionRenderOwners): CollectionRenderer {
  return {
    render: (collection, workspace, signal) => render(collection, workspace, signal, owners),
  };
}

/**
 * Selects the bytes the collection pins and holds them under a read lease until production
 * settles, so font and image payloads cannot vanish mid-render. Fails with `unavailable` at the
 * selector's path when the bytes cannot be selected, and at Assets' path when the lease cannot be
 * acquired (owner failure kept as source); otherwise answers as `produce`. The lease is always
 * released; its release result is ignored.
 */
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

/**
 * Builds the read job (id `read:<collection>:<revision>`, no previous scene) and produces it. A
 * stale read is discarded by the browser's requested-generation check. Fails with `unavailable`
 * at the job's path when the job cannot be built (job failure kept as source); producer failures
 * pass through.
 */
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
