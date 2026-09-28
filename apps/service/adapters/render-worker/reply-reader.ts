/*
 * Why this file exists
 *
 * A render worker's reply arrives as plain data, and a bad reply must never reach the browser. For
 * example, the reply for `my-diagram` must repeat exactly the fonts and options its job sent, and
 * carry a scene Layout accepts.
 *
 * This file checks one reply against the job that asked for it, and rebuilds the drawn document.
 * Presentation and Layout check their own parts. Any mismatch is one mistake, `invalid-input` at
 * `render-response`, and the caller keeps its last picture. It never passes on unchecked data.
 */
import type { z } from 'zod';
import {
  readMeasuredProjection,
  readMeasuredContent,
  readSupplementalMeasurements,
  resolvedStyle,
  fontSet,
} from '@novakai/canvas-presentation';
import type {
  Diagnostic as PresentationDiagnostic,
  DomainReader,
  Result as PresentationResult,
} from '@novakai/canvas-presentation';
import { readScene, defaultEngineVersions, options } from '@novakai/canvas-layout';
import type { Result as LayoutResult, ProjectionReader, Scene } from '@novakai/canvas-layout';
import { renderDocumentMessage } from '../../contract/records/rendering/worker.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** A reply as the render envelope checked it; every payload is still unknown. */
type RenderReply = z.infer<typeof renderDocumentMessage>;

/** The reply's geometry, decoded and admitted. */
interface AdmittedGeometry {
  readonly projection: RenderDocument['projection'];
  readonly measurements: RenderDocument['measurements'];
  readonly scene: Scene;
}

/** The reply's fonts and style, as Presentation decoded them. */
interface DecodedAppearance {
  readonly fonts: RenderDocument['fonts'];
  readonly style: RenderDocument['style'];
}

/**
 * Checks a worker's reply against the job that asked for it, and rebuilds the drawn document.
 * The reply must repeat the job's collection, fonts, style and options exactly; Presentation and
 * Layout then check the drawing itself. Fails with `invalid-input` at `render-response` when
 * anything doesn't match or a check fails.
 */
export function readRenderDocument(
  workerReply: unknown,
  job: RenderingJob,
): Result<RenderDocument> {
  const reply = readEchoedReply(workerReply, job);
  if (!reply.ok) {
    return reply;
  }
  const geometry = admitGeometry(reply.value, job);
  if (!geometry.ok) {
    return geometry;
  }
  return assembleDocument(reply.value, geometry.value, job);
}

/**
 * Reads the reply's outer shape, and checks it repeats the job's collection, fonts, style and
 * options exactly. Structured clone keeps property order, so their JSON texts must match.
 */
function readEchoedReply(
  workerReply: unknown,
  job: RenderingJob,
): Result<RenderReply> {
  const reply = decodeReplyPart(renderDocumentMessage, workerReply);
  if (!reply.ok) {
    return reply;
  }
  const sentParts = [job.collection, job.fonts, job.style, job.options];
  const echoedParts = [
    reply.value.collection,
    reply.value.fonts,
    reply.value.style,
    reply.value.options,
  ];
  if (!hasSameJson(sentParts, echoedParts)) {
    return replyMismatchFailure();
  }
  return reply;
}

/** Has Presentation decode the measurements and the projection, then Layout check the scene. */
function admitGeometry(
  reply: RenderReply,
  job: RenderingJob,
): Result<AdmittedGeometry> {
  const measurements = readSupplementalMeasurements(reply.measurements);
  if (!measurements.ok) {
    return replyMismatchFailure();
  }
  const projection = readProjection(reply.projection, job);
  if (!projection.ok) {
    return projection;
  }
  return admitScene(reply, measurements.value, projection.value);
}

/**
 * Decodes the reply's projection through Presentation, from a JSON copy: the same copy Layout
 * reads (see `decodedProjectionReader`).
 */
function readProjection(
  replyProjection: unknown,
  job: RenderingJob,
): Result<RenderDocument['projection']> {
  const copy = jsonCopy(replyProjection);
  if (!copy.ok) {
    return copy;
  }
  const projection = readMeasuredProjection(copy.value, job.collection, jobDomain(job));
  if (!projection.ok) {
    return replyMismatchFailure();
  }
  return success(projection.value);
}

/**
 * Has Layout check the reply's scene against the known engine versions and the decoded
 * projection, then keeps the scene with the geometry it was checked against.
 */
function admitScene(
  reply: RenderReply,
  measurements: RenderDocument['measurements'],
  projection: RenderDocument['projection'],
): Result<AdmittedGeometry> {
  const sceneInput = {
    projection: reply.projection,
    measurements,
    options: reply.options,
    candidate: reply.scene,
  };
  const sceneOwners = {
    engineVersions: defaultEngineVersions,
    projection: decodedProjectionReader(projection),
  };
  const scene = readScene(sceneInput, sceneOwners);
  if (!scene.ok) {
    return replyMismatchFailure();
  }
  const geometry: AdmittedGeometry = { projection, measurements, scene: scene.value };
  return success(geometry);
}

/**
 * Puts the drawn document together: the job's collection, the admitted geometry, and the reply's
 * fonts, style and options as Presentation and Layout decode them.
 */
function assembleDocument(
  reply: RenderReply,
  geometry: AdmittedGeometry,
  job: RenderingJob,
): Result<RenderDocument> {
  const appearance = decodeAppearance(reply);
  if (!appearance.ok) {
    return appearance;
  }
  const layoutOptions = decodeReplyPart(options, reply.options);
  if (!layoutOptions.ok) {
    return layoutOptions;
  }
  const drawn: RenderDocument = {
    collection: job.collection,
    projection: geometry.projection,
    measurements: geometry.measurements,
    scene: geometry.scene,
    fonts: appearance.value.fonts,
    style: appearance.value.style,
    options: layoutOptions.value,
  };
  return success(drawn);
}

/** Has Presentation decode the reply's fonts, then its style. */
function decodeAppearance(reply: RenderReply): Result<DecodedAppearance> {
  const fonts = decodeReplyPart(fontSet, reply.fonts);
  if (!fonts.ok) {
    return fonts;
  }
  const style = decodeReplyPart(resolvedStyle, reply.style);
  if (!style.ok) {
    return style;
  }
  const appearance: DecodedAppearance = { fonts: fonts.value, style: style.value };
  return success(appearance);
}

/**
 * Gives Layout a projection reader for a reply whose projection `readProjection` already decoded.
 * Layout reads a JSON copy of that same projection, so `read` answers the decoded one instead of
 * decoding it again. Presentation decodes the headings.
 */
function decodedProjectionReader(projection: RenderDocument['projection']): ProjectionReader {
  return {
    read: () => success(projection),
    content: (input) => contentForLayout(readMeasuredContent(input)),
  };
}

/** Gives Presentation a domain reader for a reply: the collection is always the job's, already valid. */
function jobDomain(job: RenderingJob): DomainReader {
  return { read: () => success(job.collection) };
}

/**
 * Gives Presentation's answer in Layout's terms. Unlike derive.ts, Presentation's mistake is not
 * kept as the source.
 */
function contentForLayout<T>(outcome: PresentationResult<T>): LayoutResult<T> {
  if (!outcome.ok) {
    return layoutContentFailure(outcome.error);
  }
  return success(outcome.value);
}

/** Whether both have the same JSON text. Values that can't be written as JSON never match. */
function hasSameJson(
  sent: unknown,
  echoed: unknown,
): boolean {
  try {
    const sentJson = JSON.stringify(sent);
    const echoedJson = JSON.stringify(echoed);
    return sentJson === echoedJson;
  } catch {
    return false;
  }
}

/** Makes a copy by writing the reply part as JSON and reading it back. */
function jsonCopy(replyPart: unknown): Result<unknown> {
  try {
    const jsonText = JSON.stringify(replyPart);
    const copy: unknown = JSON.parse(jsonText);
    return success(copy);
  } catch {
    return replyMismatchFailure();
  }
}

/** Decodes one reply part with its schema. */
function decodeReplyPart<T>(
  schema: z.ZodType<T>,
  replyPart: unknown,
): Result<T> {
  const decoded = schema.safeParse(replyPart);
  if (!decoded.success) {
    return replyMismatchFailure();
  }
  return success(decoded.data);
}

/** Makes the one mistake for a reply: it doesn't match its job, or an owner refused part of it. */
function replyMismatchFailure(): Result<never> {
  return failure(
    'invalid-input',
    'render-response',
    'Rendering response does not match the admitted job',
  );
}

/** Makes Layout's mistake from Presentation's: `invalid-input` with no targets. */
function layoutContentFailure(presentationFailure: PresentationDiagnostic): LayoutResult<never> {
  return { ok: false, error: { ...presentationFailure, code: 'invalid-input', targets: [] } };
}
