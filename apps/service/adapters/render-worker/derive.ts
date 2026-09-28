/*
 * Why this file exists
 *
 * A render job holds a collection and everything needed to draw it: fonts, style, images and
 * layout options. For example, the job for `my-diagram` becomes a drawn document
 * (`RenderDocument`): the collection with every node placed and every wire routed.
 *
 * This file does the drawing. Presentation measures the text and boxes, then Layout places the
 * nodes and routes the wires, from scratch each time. Each step answers a `Result`
 * (contract/errors.ts). It runs on a render worker thread and in `pnpm render:png`. It never reads
 * the workspace, and never saves anything.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import { validate, fieldTypeDisplay, typeUseDisplay } from '@novakai/canvas-model';
import {
  composePresentation,
  readMeasuredProjection,
  readMeasuredContent,
} from '@novakai/canvas-presentation';
import type {
  Result as PresentationResult,
  InputCollection,
  Owners as PresentationOwners,
  VisualAsset,
} from '@novakai/canvas-presentation';
import { composeLayout } from '@novakai/canvas-layout';
import type {
  Result as LayoutResult,
  LayoutOwners,
  ProjectionReader,
  Scene,
} from '@novakai/canvas-layout';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import { andThen, failure, success, type Result } from '../../contract/errors.js';

/** The collection as Presentation measured it. */
interface MeasuredCollection {
  readonly projection: RenderDocument['projection'];
  readonly measurements: RenderDocument['measurements'];
}

/**
 * Draws the job's collection and returns the drawn document. Presentation measures it, then Layout
 * places and routes it.
 * Mistakes: `invalid-input` at `render` when Model, Presentation or Layout refuses the job, and
 * `unavailable` at `render` when measuring or layout crashes.
 * `signal` is only there to fit the `DiagramProducer` port. Nothing aborts it: the worker pool
 * cancels a job by ending its thread.
 */
export async function produceDiagram(
  job: RenderingJob,
  signal: AbortSignal,
): Promise<Result<RenderDocument>> {
  try {
    return await deriveDocument(job, signal);
  } catch {
    return failure('unavailable', 'render', 'Diagram measurement or layout could not complete');
  }
}

/** Measures, then arranges, then assembles the document (see `produceDiagram`). */
async function deriveDocument(
  job: RenderingJob,
  signal: AbortSignal,
): Promise<Result<RenderDocument>> {
  const measured = await measureCollection(job);
  if (!measured.ok) return measured;
  const scene = await arrangeCollection(measured.value, job, signal);
  return andThen(scene, (arranged) => success(renderDocument(job, measured.value, arranged)));
}

/**
 * Composes Presentation for the job, then projects and measures its collection. Fails with
 * `invalid-input` at `render` when Presentation or Model rejects them (see `fromOwner`).
 */
async function measureCollection(job: RenderingJob): Promise<Result<MeasuredCollection>> {
  const composed = fromOwner(await composePresentation(presentationOwners(job), job.fonts));
  if (!composed.ok) return composed;
  const { presentation } = composed.value;
  const projection = fromOwner(presentation.project(job.collection));
  if (!projection.ok) return projection;
  const measurements = fromOwner(presentation.supplement(job.collection));
  return andThen(measurements, (supplemental) =>
    success({ projection: projection.value, measurements: supplemental }),
  );
}

/**
 * Composes Layout for the job, keys the request, then arranges the measured collection. Fails with
 * `invalid-input` at `render` when Layout rejects the request or the job is cancelled (see
 * `fromOwner`).
 */
async function arrangeCollection(
  measured: MeasuredCollection,
  job: RenderingJob,
  signal: AbortSignal,
): Promise<Result<Scene>> {
  const layout = fromOwner(await composeLayout(layoutOwners(job, signal)));
  if (!layout.ok) return layout;
  // Layout can keep a previous scene's geometry; the service always lays out from scratch.
  const request = {
    projection: measured.projection,
    measurements: measured.measurements,
    options: job.options,
    previous: null,
  };
  const inputKey = fromOwner(layout.value.key(request));
  if (!inputKey.ok) return inputKey;
  const layoutJob = { id: job.id, inputKey: inputKey.value };
  return fromOwner(await layout.value.arrange({ ...request, job: layoutJob }));
}

/** The document: the job's inputs with the measured collection and its scene. */
function renderDocument(
  job: RenderingJob,
  measured: MeasuredCollection,
  scene: Scene,
): RenderDocument {
  return {
    collection: job.collection,
    projection: measured.projection,
    measurements: measured.measurements,
    options: job.options,
    scene,
    fonts: job.fonts,
    style: job.style,
  };
}

/**
 * The owner's value. An owner rejection becomes `invalid-input` at `render` ("A rendering owner
 * rejected the input") with the owner's failure as source; the caller corrects the resources.
 */
function fromOwner<T>(outcome: Result<T, FailureSource>): Result<T> {
  if (!outcome.ok)
    return failure(
      'invalid-input',
      'render',
      'A rendering owner rejected the input',
      outcome.error,
    );
  return success(outcome.value);
}

/** Presentation's owners for one job: Model, the job's resolved style, the job's pinned media. */
function presentationOwners(job: RenderingJob): PresentationOwners {
  return {
    domain: presentationDomain,
    themes: { resolve: () => ({ ok: true, value: job.style }) },
    assets: { read: (digest) => readPinnedAsset(digest, job.assets) },
  };
}

/**
 * Layout's owners for one job: the job's projection reader, its libavoid wasm, and cooperative
 * scheduling that stops once `signal` aborts.
 */
function layoutOwners(
  job: RenderingJob,
  signal: AbortSignal,
): LayoutOwners {
  return {
    projection: projectionReader(job),
    wasmResource: job.wasmResource,
    jobs: { isCurrent: () => !signal.aborted, yield: yieldJob },
  };
}

/**
 * Model validates the canonical collection. Fails with Presentation's `invalid-input` at
 * `collection` ("Model rejected the rendering input", Model's failure as source); there is no
 * second domain validator.
 */
function readCollection(input: unknown): PresentationResult<InputCollection> {
  const validated = validate(input);
  if (validated.ok) return validated;
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'collection',
      message: 'Model rejected the rendering input',
      source: validated.error,
      recovery: 'Correct the canonical collection through Authoring.',
    },
  };
}

/** Presentation's domain reader: Model's validation and display names. */
const presentationDomain = {
  read: readCollection,
  resolveFieldType: fieldTypeDisplay,
  resolveTypeUse: typeUseDisplay,
};

/**
 * The job's pinned media with this digest. Fails with `missing-resource` at the digest ("Pinned
 * media is unavailable"); missing media is never replaced by an empty visual.
 */
function readPinnedAsset(
  digest: string,
  assets: readonly VisualAsset[],
): PresentationResult<VisualAsset> {
  const found = assets.find((pinned) => pinned.digest === digest);
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

/** Presentation's failure in Layout's vocabulary: `invalid-input`, no targets, the original kept. */
function forLayout<T>(outcome: PresentationResult<T>): LayoutResult<T> {
  if (outcome.ok) return outcome;
  return {
    ok: false,
    error: { ...outcome.error, code: 'invalid-input', targets: [], source: outcome.error },
  };
}

/**
 * Layout's projection reader for one job: each read decodes its input against the job's
 * collection, through Presentation.
 */
function projectionReader(job: RenderingJob): ProjectionReader {
  return {
    read: (input) => forLayout(readMeasuredProjection(input, job.collection, presentationDomain)),
    content: (input) => forLayout(readMeasuredContent(input)),
  };
}

/**
 * Yields to the event loop so an abort can arrive between native phases. Terminating the worker
 * remains the hard cancellation.
 */
function yieldJob(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
