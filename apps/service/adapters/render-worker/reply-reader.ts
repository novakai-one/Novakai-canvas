import {
  readMeasuredProjection,
  readMeasuredContent,
  readSupplementalMeasurements,
  resolvedStyle,
  fontSet,
} from '@novakai/canvas-presentation';
import type { Result as PresentationResult } from '@novakai/canvas-presentation';
import { readScene, defaultEngineVersions, options } from '@novakai/canvas-layout';
import type { Result as LayoutResult } from '@novakai/canvas-layout';
import { renderEnvelope } from '../../contract/records/worker.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering.js';
import { failure, type Result } from '../../contract/errors.js';
/** Typed local decoding failures are caught before the service exposes a worker response. */
class ReadoutFault extends Error {}
/** Owner rejection produces no partially admitted scene. */
function accepted<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new ReadoutFault('Owner rejected rendering data');
  return result.value;
}
/** Structured clone preserves property order; these fields must be exactly the admitted job's values. */
function same(
  expected: unknown,
  actual: unknown,
): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new ReadoutFault('Worker response differs from its request');
}
/** Layout receives the Presentation failure in its own consumer vocabulary. */
function translated<T>(result: PresentationResult<T>): LayoutResult<T> {
  if (result.ok) return result;
  return { ok: false, error: { ...result.error, code: 'invalid-input', targets: [] } };
}
/** Reconstruct all scene payloads using admitted job semantics; no wire payload is cast into trusted records. */
function decode(
  input: unknown,
  job: RenderingJob,
): RenderDocument {
  const raw = renderEnvelope.parse(input);
  same(
    [job.collection, job.fonts, job.style, job.options],
    [raw.collection, raw.fonts, raw.style, raw.options],
  );
  const domain = {
    read: (): PresentationResult<RenderingJob['collection']> => ({
      ok: true,
      value: job.collection,
    }),
  };
  let projection: ReturnType<typeof readMeasuredProjection> | undefined;
  const measurements = accepted(readSupplementalMeasurements(raw.measurements));
  const scene = accepted(
    readScene(
      { projection: raw.projection, measurements, options: raw.options, candidate: raw.scene },
      {
        engineVersions: defaultEngineVersions,
        projection: {
          read: (input) => {
            projection = readMeasuredProjection(input, job.collection, domain);
            return translated(projection);
          },
          content: (input) => translated(readMeasuredContent(input)),
        },
      },
    ),
  );
  if (projection === undefined) throw new ReadoutFault('Layout omitted projection admission');
  return {
    collection: job.collection,
    projection: accepted(projection),
    measurements,
    scene,
    fonts: fontSet.parse(raw.fonts),
    style: resolvedStyle.parse(raw.style),
    options: options.parse(raw.options),
  };
}
/** Reject stale/malformed worker output; host keeps the prior scene and exposes a retry instead of mounting unchecked data. */
export function readRenderDocument(
  input: unknown,
  job: RenderingJob,
): Result<RenderDocument> {
  try {
    return { ok: true, value: decode(input, job) };
  } catch {
    return failure(
      'invalid-input',
      'render-response',
      'Rendering response does not match the admitted job',
    );
  }
}
