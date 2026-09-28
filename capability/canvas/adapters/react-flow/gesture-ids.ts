/*
 * Gesture identities for the canvas interactions. The host supplies random text for each new
 * gesture; this file parses it into a Canvas `GestureId` when the gesture begins. Not pure: it calls
 * the host's text source and reports a refused text to the host's `onError`. When parsing fails no
 * gesture starts; the host owns recovery (a working text source).
 */
import { gestureId, type GestureId } from '../../contract/brands.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import type { NextGestureId, SurfaceHost } from '../../contract/react-types.js';

/**
 * Builds the source the interactions call when a gesture begins. Each call reads one text from the
 * host and parses it. A refused text is reported to the host here, once, and returned as the
 * `invalid-input` failure, so the caller only starts no gesture.
 */
export function createGestureIds(
  host: Pick<SurfaceHost, 'nextGestureId' | 'onError'>,
): NextGestureId {
  return function nextGestureId(): Result<GestureId> {
    const text = host.nextGestureId();
    const parsed = parseGestureId(text);
    if (!parsed.ok) host.onError(parsed.error);
    return parsed;
  };
}

/** Parses one host text into a gesture identity. Fails with `invalid-input` at `nextGestureId`. */
function parseGestureId(text: string): Result<GestureId> {
  const parsed = gestureId.safeParse(text);
  if (!parsed.success) return { ok: false, error: refusedGestureText };
  return { ok: true, value: parsed.data };
}

/** Why no gesture started: the host's text is not 1 to 500 characters. */
const refusedGestureText: Diagnostic = Object.freeze({
  code: 'invalid-input',
  path: 'nextGestureId',
  targets: [],
  message: 'The gesture did not start: the host gave no usable gesture identity.',
  recovery: 'Host returns 1 to 500 characters from nextGestureId; the person repeats the gesture.',
});
