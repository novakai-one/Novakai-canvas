import type { FailureSource } from '../../contract/records/failure-source.js';
import { validate, fieldTypeDisplay, typeUseDisplay } from '@novakai/canvas-model';
import {
  composePresentation,
  readMeasuredProjection,
  readMeasuredContent,
} from '@novakai/canvas-presentation';
import type {
  Result as PresentationResult,
  InputCollection,
  VisualAsset,
} from '@novakai/canvas-presentation';
import { composeLayout } from '@novakai/canvas-layout';
import type { Result as LayoutResult, ProjectionReader } from '@novakai/canvas-layout';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering.js';
import { failure, type Result } from '../../contract/errors.js';
/** A structured local failure is translated only at produce; callers retain current scene and retry corrected resources. */
class RenderingFault extends Error {
  constructor(readonly diagnostic: FailureSource) {
    super('Rendering owner rejected input');
  }
}
/** Owner failures stop the pipeline before exposing partial geometry; exception text is never used as a branch condition. */
function accepted<T>(result: Result<T, FailureSource>): T {
  if (!result.ok) throw new RenderingFault(result.error);
  return result.value;
}
/** Model validates canonical data; Presentation receives its own error vocabulary without a second domain validator. */
function domain(input: unknown): PresentationResult<InputCollection> {
  const result = validate(input);
  if (result.ok) return result;
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'collection',
      message: 'Model rejected the rendering input',
      source: result.error,
      recovery: 'Correct the canonical collection through Authoring.',
    },
  };
}
const presentationDomain = {
  read: domain,
  resolveFieldType: fieldTypeDisplay,
  resolveTypeUse: typeUseDisplay,
};
/** Missing immutable media is an explicit preview failure, never an empty visual substitute. */
function asset(
  digest: string,
  assets: readonly VisualAsset[],
): PresentationResult<VisualAsset> {
  const found = assets.find((item) => item.digest === digest);
  if (found) return { ok: true, value: found };
  return {
    ok: false,
    error: {
      code: 'missing-resource',
      path: digest,
      message: 'Pinned media is unavailable',
      recovery: 'Restore the admitted bytes before retrying.',
    },
  };
}
/** Consumer error translation preserves failure while adapting the required Layout target list. */
function forLayout<T>(result: PresentationResult<T>): LayoutResult<T> {
  if (result.ok) return result;
  return {
    ok: false,
    error: { ...result.error, code: 'invalid-input', targets: [], source: result.error },
  };
}
/** Bind one immutable canonical collection; transported projections are decoded by their owner on every read. */
function projectionReader(job: RenderingJob): ProjectionReader {
  return {
    read: (input) => forLayout(readMeasuredProjection(input, job.collection, presentationDomain)),
    content: (input) => forLayout(readMeasuredContent(input)),
  };
}
/** Cooperative yield lets abort delivery run between native phases; worker termination remains the hard cancellation boundary. */
function yieldJob(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
/** Compose real measurement and engines inside the worker, with no database handle or mutable service state. */
async function derive(
  job: RenderingJob,
  signal: AbortSignal,
): Promise<RenderDocument> {
  const bound = accepted(
    await composePresentation(
      {
        domain: presentationDomain,
        themes: { resolve: () => ({ ok: true, value: job.style }) },
        assets: { read: (digest) => asset(digest, job.assets) },
      },
      job.fonts,
    ),
  );
  const projection = accepted(bound.presentation.project(job.collection));
  const measurements = accepted(bound.presentation.supplement(job.collection));
  const layout = accepted(
    await composeLayout({
      projection: projectionReader(job),
      wasmResource: job.wasmResource,
      jobs: { isCurrent: () => !signal.aborted, yield: yieldJob },
    }),
  );
  const request = { projection, measurements, options: job.options, previous: job.previous };
  const inputKey = accepted(layout.key(request));
  const scene = accepted(await layout.arrange({ ...request, job: { id: job.id, inputKey } }));
  return {
    collection: job.collection,
    projection,
    measurements,
    options: job.options,
    scene,
    fonts: job.fonts,
    style: job.style,
  };
}
/** Run only in the rendering worker; host retains the accepted scene/draft on failure and discards stale job generations. */
export async function produceDiagram(
  job: RenderingJob,
  signal: AbortSignal,
): Promise<Result<RenderDocument>> {
  try {
    return { ok: true, value: await derive(job, signal) };
  } catch (error) {
    return renderingFailure(error);
  }
}
/** Expected owner rejection is actionable input; unexpected native failure asks the caller to restore dependencies. */
function renderingFailure(error: unknown): Result<never> {
  if (error instanceof RenderingFault)
    return failure(
      'invalid-input',
      'render',
      'A rendering owner rejected the input',
      error.diagnostic,
    );
  return failure('unavailable', 'render', 'Diagram measurement or layout could not complete');
}
