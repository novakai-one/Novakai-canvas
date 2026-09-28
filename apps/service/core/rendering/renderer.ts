/*
 * Why this file exists
 *
 * Drawing a saved collection takes a moment, and its font and image files must not vanish
 * halfway. For example, clean-up must not remove a font `my-diagram` uses while it is being drawn.
 *
 * This file draws one saved collection: it holds the collection's stored files (a "lease") until
 * the drawing is done, builds its `read` job and runs it. Each step answers a `Result` (see
 * `contract/errors.ts`). It never saves, and never retries.
 */
import type { Assets, Collection } from '../../contract/records/capability-types.js';
import type {
  CollectionRenderer,
  DiagramProducer,
  RenderJobs,
} from '../../contract/ports/rendering.js';
import type { ResourceSelector } from '../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { failure, type Result } from '../../contract/errors.js';

/** What the renderer uses to hold a collection's files, build its job and run it. */
export interface CollectionRendererDependencies {
  /** Assets, which holds stored files until they are let go. */
  readonly assets: Pick<Assets, 'acquire'>;
  /** Builds the render job (jobs.ts). */
  readonly jobs: RenderJobs;
  /** Runs a job on a render worker and checks the reply (produce.ts, behind cache.ts). */
  readonly producer: DiagramProducer;
  /** Lists the stored files a collection uses, by their content hashes. */
  readonly resources: Pick<ResourceSelector, 'digestsForCollection'>;
}

/**
 * Makes the renderer for saved collections. Its `render` draws one collection, holding its files
 * until the drawing is done.
 * Mistakes: `unavailable` when the files can't be found or held, or the job can't be built. So the
 * job builder's `missing-asset` or `invalid-input` comes back as `unavailable`, kept as its source.
 * The producer's own mistakes pass through.
 */
export function createCollectionRenderer(
  dependencies: CollectionRendererDependencies,
): CollectionRenderer {
  return {
    render: (collection, workspace, signal) => render(collection, workspace, signal, dependencies),
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
  owners: CollectionRendererDependencies,
): Promise<Result<RenderDocument>> {
  const resources = owners.resources.digestsForCollection(collection, workspace);
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
 * Builds the `read` job and produces it. A stale read is discarded by the browser's
 * requested-generation check. Fails with `unavailable` at the job's path when the job cannot be
 * built (job failure kept as source); producer failures pass through.
 */
async function produce(
  collection: Collection,
  workspace: WorkspaceContents,
  signal: AbortSignal,
  owners: CollectionRendererDependencies,
): Promise<Result<RenderDocument>> {
  const job = owners.jobs.create(collection, workspace, 'read');
  if (!job.ok) return failure('unavailable', job.error.path, job.error.message, job.error);
  return owners.producer.produce(job.value, signal);
}
