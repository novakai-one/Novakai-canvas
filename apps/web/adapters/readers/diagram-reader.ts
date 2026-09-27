import { renderEnvelope } from '@novakai/canvas-service';
import type { RenderDocument } from '@novakai/canvas-service';
import { validate, fieldTypeDisplay, typeUseDisplay } from '@novakai/canvas-model';
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
import type { SceneAdmission } from '@novakai/canvas-canvas';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** Raw transport data always receives every owner check; already admitted immutable identity is reusable. */
export function readDiagram(input: unknown): Result<RenderDocument> {
  try {
    const admitted = previouslyAdmitted(input);
    if (admitted !== undefined) return { ok: true, value: admitted };
    const document = immutable(decode(input));
    admittedDocuments.set(document, document);
    return { ok: true, value: document };
  } catch {
    return failure('invalid-diagram', 'The rendered diagram could not be validated');
  }
}
/** Canvas independently checks the stamp and its interaction geometry after this full owner readout. */
export function createSceneAdmission(): SceneAdmission {
  return {
    read: (input) => {
      const document = readDiagram(input);
      if (!document.ok)
        return {
          ok: false,
          error: {
            code: 'invalid-input',
            path: 'diagram',
            targets: [],
            message: document.error.message,
            recovery: document.error.recovery,
          },
        };
      return { ok: true, value: document.value.scene };
    },
  };
}
/** WeakMap identity reuse applies only to object inputs already admitted through this page. */
function previouslyAdmitted(input: unknown): RenderDocument | undefined {
  return input !== null && typeof input === 'object' ? admittedDocuments.get(input) : undefined;
}
/** Private boundary rejection is caught into a readable failure; the browser retains its previous scene. */
class DiagramRejected extends Error {}
/** Owner results, never casts, turn serialized content into a trusted diagram. */
function accepted<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new DiagramRejected();
  return result.value;
}
/** Translate only the consumer's error vocabulary; Projection remains Presentation-owned. */
function layoutResult<T>(result: PresentationResult<T>): LayoutResult<T> {
  if (result.ok) return result;
  return { ok: false, error: { ...result.error, code: 'invalid-input', targets: [] } };
}
/** Canonical shape, measured content, routing and engine versions all receive their owner's independent admission. */
function decode(input: unknown): RenderDocument {
  const payload = renderEnvelope.parse(input);
  const collection = accepted(validate(payload.collection));
  const domain = {
    read: (input: unknown): PresentationResult<typeof collection> => {
      const checked = validate(input);
      if (!checked.ok)
        return {
          ok: false,
          error: {
            code: 'invalid-input',
            path: 'collection',
            message: 'Invalid collection',
            recovery: 'Refresh the committed collection',
          },
        };
      return checked;
    },
    resolveFieldType: fieldTypeDisplay,
    resolveTypeUse: typeUseDisplay,
  };
  let projection: ReturnType<typeof readMeasuredProjection> | undefined;
  const measurements = accepted(readSupplementalMeasurements(payload.measurements));
  const scene = accepted(
    readScene(
      {
        projection: payload.projection,
        measurements,
        options: payload.options,
        candidate: payload.scene,
      },
      {
        engineVersions: defaultEngineVersions,
        projection: {
          read: (input) => {
            projection = readMeasuredProjection(input, collection, domain);
            return layoutResult(projection);
          },
          content: (input) => layoutResult(readMeasuredContent(input)),
        },
      },
    ),
  );
  if (projection === undefined) throw new DiagramRejected('Layout omitted projection admission');
  return {
    collection,
    projection: accepted(projection),
    measurements,
    scene,
    fonts: fontSet.parse(payload.fonts),
    style: resolvedStyle.parse(payload.style),
    options: options.parse(payload.options),
  };
}
/** Only our own immutable admission results can reuse an owner check within this page. */
const admittedDocuments = new WeakMap<object, RenderDocument>();
/** Admitted documents are deep-frozen so reuse across readers never mutates owner state. */
function immutable<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(immutable);
  return Object.freeze(value);
}
