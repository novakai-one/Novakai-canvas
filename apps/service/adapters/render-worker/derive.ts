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
  Diagnostic as PresentationDiagnostic,
  Result as PresentationResult,
  InputCollection,
  Owners as PresentationOwners,
  Presentation,
  VisualAsset,
} from '@novakai/canvas-presentation';
import { composeLayout } from '@novakai/canvas-layout';
import type {
  Layout,
  Result as LayoutResult,
  LayoutOwners,
  ProjectionReader,
  Scene,
} from '@novakai/canvas-layout';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import { failure, success, type Result } from '../../contract/errors.js';

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
    return await drawDocument(job, signal);
  } catch {
    return drawingCrashedFailure();
  }
}

/** Measures the collection, then places and routes it, then puts the drawn document together. */
async function drawDocument(
  job: RenderingJob,
  signal: AbortSignal,
): Promise<Result<RenderDocument>> {
  const measured = await measureCollection(job);
  if (!measured.ok) {
    return measured;
  }
  const scene = await arrangeCollection(measured.value, job, signal);
  if (!scene.ok) {
    return scene;
  }
  const drawn = assembleDocument(job, measured.value, scene.value);
  return success(drawn);
}

/** Sets up Presentation for the job, then measures the job's collection with it. */
async function measureCollection(job: RenderingJob): Promise<Result<MeasuredCollection>> {
  const composed = await composePresentation(presentationOwners(job), job.fonts);
  if (!composed.ok) {
    return ownerRefusedFailure(composed.error);
  }
  return measureWith(composed.value.presentation, job.collection);
}

/** Projects the collection, then measures the sizes of its text and boxes. */
function measureWith(
  presentation: Presentation,
  collection: RenderingJob['collection'],
): Result<MeasuredCollection> {
  const projection = presentation.project(collection);
  if (!projection.ok) {
    return ownerRefusedFailure(projection.error);
  }
  const measurements = presentation.supplement(collection);
  if (!measurements.ok) {
    return ownerRefusedFailure(measurements.error);
  }
  const measured: MeasuredCollection = {
    projection: projection.value,
    measurements: measurements.value,
  };
  return success(measured);
}

/** Sets up Layout for the job, then places the nodes and routes the wires of the collection. */
async function arrangeCollection(
  measured: MeasuredCollection,
  job: RenderingJob,
  signal: AbortSignal,
): Promise<Result<Scene>> {
  const layout = await composeLayout(layoutOwners(job, signal));
  if (!layout.ok) {
    return ownerRefusedFailure(layout.error);
  }
  return arrangeWith(layout.value, measured, job);
}

/** Works out the layout request's key, then asks Layout to arrange the request from scratch. */
async function arrangeWith(
  layout: Layout,
  measured: MeasuredCollection,
  job: RenderingJob,
): Promise<Result<Scene>> {
  // Layout can keep a previous scene's geometry; the service always lays out from scratch.
  const request = {
    projection: measured.projection,
    measurements: measured.measurements,
    options: job.options,
    previous: null,
  };
  const inputKey = layout.key(request);
  if (!inputKey.ok) {
    return ownerRefusedFailure(inputKey.error);
  }
  const layoutJob = { id: job.id, inputKey: inputKey.value };
  const scene = await layout.arrange({ ...request, job: layoutJob });
  if (!scene.ok) {
    return ownerRefusedFailure(scene.error);
  }
  return success(scene.value);
}

/** Puts the drawn document together: the job's inputs, the measured collection and its scene. */
function assembleDocument(
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

/** Gives Presentation what it needs for one job: Model, the job's style, the job's images. */
function presentationOwners(job: RenderingJob): PresentationOwners {
  return {
    domain: presentationDomain,
    themes: { resolve: () => success(job.style) },
    assets: { read: (digest) => readPinnedAsset(digest, job.assets) },
  };
}

/**
 * Gives Layout what it needs for one job: its projection reader, its libavoid file, and a check
 * that stops the work once `signal` aborts.
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

/** Checks the collection with Model; there is no second checker. */
function readCollection(input: unknown): PresentationResult<InputCollection> {
  const validated = validate(input);
  if (!validated.ok) {
    return modelRefusedFailure(validated.error);
  }
  return success(validated.value);
}

/** Presentation's domain reader: Model's check and display names. */
const presentationDomain = {
  read: readCollection,
  resolveFieldType: fieldTypeDisplay,
  resolveTypeUse: typeUseDisplay,
};

/** Finds the job's image with this digest. A missing image is never drawn as an empty one. */
function readPinnedAsset(
  digest: string,
  assets: readonly VisualAsset[],
): PresentationResult<VisualAsset> {
  const pinned = assets.find((asset) => asset.digest === digest);
  if (pinned === undefined) {
    return missingMediaFailure(digest);
  }
  return success(pinned);
}

/** Gives Layout a projection reader that decodes each input against the job's collection. */
function projectionReader(job: RenderingJob): ProjectionReader {
  return {
    read: (input) => forLayout(readMeasuredProjection(input, job.collection, presentationDomain)),
    content: (input) => forLayout(readMeasuredContent(input)),
  };
}

/** Gives Presentation's answer in Layout's terms. */
function forLayout<T>(outcome: PresentationResult<T>): LayoutResult<T> {
  if (!outcome.ok) {
    return layoutInputFailure(outcome.error);
  }
  return success(outcome.value);
}

/**
 * Lets the event loop run, so an abort can arrive between native steps. Ending the worker thread
 * is still the hard way to cancel.
 */
function yieldJob(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Makes the mistake for a job that Model, Presentation or Layout refused, keeping theirs. */
function ownerRefusedFailure(ownerFailure: FailureSource): Result<never> {
  return failure('invalid-input', 'render', 'A rendering owner rejected the input', ownerFailure);
}

/** Makes the mistake for measuring or layout that crashed. */
function drawingCrashedFailure(): Result<never> {
  return failure('unavailable', 'render', 'Diagram measurement or layout could not complete');
}

/** Makes Presentation's mistake for a collection Model refused, keeping Model's mistake. */
function modelRefusedFailure(
  modelFailure: PresentationDiagnostic['source'],
): PresentationResult<never> {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'collection',
      message: 'Model rejected the rendering input',
      source: modelFailure,
      recovery: 'Correct the canonical collection through Authoring.',
    },
  };
}

/** Makes Presentation's mistake for an image the job doesn't carry, at its digest. */
function missingMediaFailure(digest: string): PresentationResult<never> {
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

/** Makes Layout's mistake from Presentation's: `invalid-input`, no targets, Presentation's kept. */
function layoutInputFailure(presentationFailure: PresentationDiagnostic): LayoutResult<never> {
  return {
    ok: false,
    error: {
      ...presentationFailure,
      code: 'invalid-input',
      targets: [],
      source: presentationFailure,
    },
  };
}
