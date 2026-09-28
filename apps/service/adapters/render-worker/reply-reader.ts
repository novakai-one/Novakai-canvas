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
import type { DomainReader, Result as PresentationResult } from '@novakai/canvas-presentation';
import { readScene, defaultEngineVersions, options } from '@novakai/canvas-layout';
import type { Result as LayoutResult, ProjectionReader, Scene } from '@novakai/canvas-layout';
import { renderDocumentMessage } from '../../contract/records/rendering/worker.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import { andThen, failure, success, type Result } from '../../contract/errors.js';

/** A reply as the render envelope checked it; every payload is still unknown. */
type RenderReply = z.infer<typeof renderDocumentMessage>;

/** The reply's geometry, decoded and admitted. */
interface AdmittedGeometry {
  readonly projection: RenderDocument['projection'];
  readonly measurements: RenderDocument['measurements'];
  readonly scene: Scene;
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
  const reply = readReply(workerReply, job);
  if (!reply.ok) return reply;
  const geometry = admitGeometry(reply.value, job);
  if (!geometry.ok) return geometry;
  return assembleDocument(reply.value, geometry.value, job);
}

/**
 * The checked envelope, when its collection, fonts, style and options are exactly the job's.
 * Structured clone keeps property order, so their JSON texts must match. Fails with the response
 * refusal when the envelope is malformed or does not echo the job (see `requireSameJson`).
 */
function readReply(
  input: unknown,
  job: RenderingJob,
): Result<RenderReply> {
  const reply = decodeReplyPart(renderDocumentMessage, input);
  if (!reply.ok) return reply;
  const echoed = requireSameJson(
    [job.collection, job.fonts, job.style, job.options],
    [reply.value.collection, reply.value.fonts, reply.value.style, reply.value.options],
  );
  return andThen(echoed, () => reply);
}

/**
 * Presentation decodes the measurements and the projection (see `readProjection`); Layout then
 * admits the scene against them (see `admitScene`). Fails with the response refusal when an owner
 * rejects any of them.
 */
function admitGeometry(
  reply: RenderReply,
  job: RenderingJob,
): Result<AdmittedGeometry> {
  const measurements = fromOwner(readSupplementalMeasurements(reply.measurements));
  if (!measurements.ok) return measurements;
  const projection = readProjection(reply.projection, job);
  if (!projection.ok) return projection;
  const scene = admitScene(reply, measurements.value, projection.value);
  return andThen(scene, (admitted) =>
    success({ projection: projection.value, measurements: measurements.value, scene: admitted }),
  );
}

/**
 * The reply's projection, decoded through Presentation from its JSON copy: the same value Layout
 * reads from its own JSON snapshot of the reply (see `decodedProjectionReader`). Fails with the
 * response refusal when the projection is not JSON (see `jsonCopy`) or Presentation rejects it.
 */
function readProjection(
  input: unknown,
  job: RenderingJob,
): Result<RenderDocument['projection']> {
  const copied = jsonCopy(input);
  return andThen(copied, (copy) =>
    fromOwner(readMeasuredProjection(copy, job.collection, jobDomain(job))),
  );
}

/**
 * The document: the job's collection, the admitted geometry, and the reply's fonts, style and
 * options as Presentation and Layout decode them. Fails with the response refusal when one of
 * them is rejected.
 */
function assembleDocument(
  reply: RenderReply,
  geometry: AdmittedGeometry,
  job: RenderingJob,
): Result<RenderDocument> {
  const fonts = decodeReplyPart(fontSet, reply.fonts);
  if (!fonts.ok) return fonts;
  const style = decodeReplyPart(resolvedStyle, reply.style);
  if (!style.ok) return style;
  const layoutOptions = decodeReplyPart(options, reply.options);
  return andThen(layoutOptions, (decodedOptions) =>
    success({
      collection: job.collection,
      projection: geometry.projection,
      measurements: geometry.measurements,
      scene: geometry.scene,
      fonts: fonts.value,
      style: style.value,
      options: decodedOptions,
    }),
  );
}

/**
 * Layout's admission of the reply's scene against the known engine versions and the decoded
 * projection (see `decodedProjectionReader`). Fails with the response refusal when Layout rejects
 * it.
 */
function admitScene(
  reply: RenderReply,
  measurements: RenderDocument['measurements'],
  projection: RenderDocument['projection'],
): Result<Scene> {
  const candidate = {
    projection: reply.projection,
    measurements,
    options: reply.options,
    candidate: reply.scene,
  };
  const owners = {
    engineVersions: defaultEngineVersions,
    projection: decodedProjectionReader(projection),
  };
  return fromOwner(readScene(candidate, owners));
}

/**
 * Layout's projection reader for a reply whose projection `readProjection` already decoded.
 * Layout's input is a JSON snapshot of that same `reply.projection`, so `read` answers with the
 * decoded projection instead of decoding it again. Headings are decoded by Presentation.
 */
function decodedProjectionReader(projection: RenderDocument['projection']): ProjectionReader {
  return {
    read: () => ({ ok: true, value: projection }),
    content: (input) => translated(readMeasuredContent(input)),
  };
}

/** Presentation's domain reader for a reply: the collection is always the job's, already valid. */
function jobDomain(job: RenderingJob): DomainReader {
  return {
    read: (): PresentationResult<RenderingJob['collection']> => ({
      ok: true,
      value: job.collection,
    }),
  };
}

/** Presentation's failure in Layout's vocabulary: `invalid-input` with no targets. */
function translated<T>(outcome: PresentationResult<T>): LayoutResult<T> {
  if (outcome.ok) return outcome;
  return { ok: false, error: { ...outcome.error, code: 'invalid-input', targets: [] } };
}

/**
 * Passes when both values have the same JSON text. Fails with the response refusal when they
 * differ or cannot be written as JSON (`JSON.stringify`'s throw on a BigInt or a cycle, caught
 * here).
 */
function requireSameJson(
  expected: unknown,
  actual: unknown,
): Result<void> {
  try {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return responseRefused();
    return success(undefined);
  } catch {
    return responseRefused();
  }
}

/**
 * The value as `JSON.stringify` writes it, read back. Fails with the response refusal when it
 * cannot be written as JSON (`JSON.stringify`'s throw, or no text for `undefined`; caught here).
 */
function jsonCopy(value: unknown): Result<unknown> {
  try {
    const copy: unknown = JSON.parse(JSON.stringify(value));
    return success(copy);
  } catch {
    return responseRefused();
  }
}

/** The owner's value. An owner rejection becomes the response refusal. */
function fromOwner<T>(
  outcome: { readonly ok: true; readonly value: T } | { readonly ok: false },
): Result<T> {
  if (!outcome.ok) return responseRefused();
  return success(outcome.value);
}

/** The reply part as the schema reads it. Fails with the response refusal when it is rejected. */
function decodeReplyPart<T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T> {
  const decoded = schema.safeParse(input);
  if (!decoded.success) return responseRefused();
  return success(decoded.data);
}

/** The one reply refusal: `invalid-input` at `render-response`. */
function responseRefused(): Result<never> {
  return failure(
    'invalid-input',
    'render-response',
    'Rendering response does not match the admitted job',
  );
}
