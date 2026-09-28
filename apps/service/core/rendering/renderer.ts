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
import type {
  Assets,
  AuthoringDiagnostic,
  Collection,
  ReadLease,
} from '../../contract/records/capability-types.js';
import type { CapabilityFailure } from '../../contract/records/transport/failure-source.js';
import type {
  CollectionRenderer,
  DiagramProducer,
  RenderJobs,
} from '../../contract/ports/rendering.js';
import type { ResourceSelector } from '../../contract/ports/workspace.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { failure, success, type Result } from '../../contract/errors.js';

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
    render: (collection, contents, signal) =>
      renderHoldingFiles(collection, contents, signal, dependencies),
  };
}

/** Holds the collection's stored files, draws it, then lets the files go. */
async function renderHoldingFiles(
  collection: Collection,
  contents: WorkspaceContents,
  signal: AbortSignal,
  dependencies: CollectionRendererDependencies,
): Promise<Result<RenderDocument>> {
  const lease = holdCollectionFiles(collection, contents, dependencies);
  if (!lease.ok) {
    return lease;
  }
  try {
    return await produceReadJob(collection, contents, signal, dependencies);
  } finally {
    // The files are always let go; what `release` answers is not used.
    lease.value.release();
  }
}

/** Finds the stored files the collection uses, then holds them so clean-up can't remove them. */
function holdCollectionFiles(
  collection: Collection,
  contents: WorkspaceContents,
  dependencies: CollectionRendererDependencies,
): Result<ReadLease> {
  const digests = dependencies.resources.digestsForCollection(collection, contents);
  if (!digests.ok) {
    return filesUnavailableFailure(digests.error);
  }
  const lease = dependencies.assets.acquire(digests.value);
  if (!lease.ok) {
    return filesUnavailableFailure(lease.error);
  }
  return success(lease.value);
}

/**
 * Builds the collection's `read` job and runs it; a stale drawing is dropped by the browser, which
 * checks the generation it asked for.
 */
async function produceReadJob(
  collection: Collection,
  contents: WorkspaceContents,
  signal: AbortSignal,
  dependencies: CollectionRendererDependencies,
): Promise<Result<RenderDocument>> {
  const job = dependencies.jobs.create(collection, contents, 'read');
  if (!job.ok) {
    return jobUnavailableFailure(job.error);
  }
  return dependencies.producer.produce(job.value, signal);
}

/**
 * Makes the `unavailable` mistake for files that can't be found or held, at the refusing part's
 * path, keeping its refusal as the source.
 */
function filesUnavailableFailure(refusal: CapabilityFailure): Result<never> {
  return failure('unavailable', refusal.path, refusal.message, refusal);
}

/**
 * Makes the `unavailable` mistake for a job that can't be built, at the job builder's path,
 * keeping its refusal as the source.
 */
function jobUnavailableFailure(refusal: AuthoringDiagnostic): Result<never> {
  return failure('unavailable', refusal.path, refusal.message, refusal);
}
