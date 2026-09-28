import { expect } from 'vitest';
import { digest } from '../contract/index.js';
import type {
  Digest,
  ErrorCode,
  Result,
  StageInput,
  MediaRegistry,
  ReachabilityReader,
} from '../contract/index.js';

/** A 2 × 3 pixel PNG, base64 encoded. */
export const png: string =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMwTpv5H4QZMBgAqdcNJ8E3/6kAAAAASUVORK5CYII=';

/** A safe 180 × 100 SVG (viewBox only) with a local arrow marker and escaped text. */
export const svg: string =
  '<svg viewBox="0 0 180 100"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5"><path d="M0 0 L10 5 L0 10Z"/></marker></defs><rect x="4" y="4" width="80" height="40"/><path d="M85 25 L160 25" marker-end="url(#arrow)"/><text x="10" y="75">Authoring &amp; validation</text></svg>';

/** A valid digest that no test stores. Parsed once, when this module loads. */
export const missing: Digest = digest.parse('f'.repeat(64));

/**
 * A reachability reader that reports no referenced digests, so collection keeps only leased bytes.
 *
 * @returns A new success with an empty list on every call.
 * @throws Never.
 */
export const noReferences: ReachabilityReader = () => ({ ok: true, value: [] });

/**
 * Encodes text as base64, for building fixtures. Staged input must still pass the canonical base64
 * checks.
 *
 * @param text - UTF-8 text.
 * @returns The base64 encoding.
 * @throws Never.
 */
export function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * Builds a staging request with fixed alt text ("A blue two by three image") and provenance. The
 * metadata is written here, never derived from Assets' own output.
 *
 * @param base64 - The bytes. Defaults to {@link png}.
 * @param mediaType - The declared type. Defaults to `image/png`.
 * @returns A new request on every call.
 * @throws Never.
 */
export function submission(
  base64: string = png,
  mediaType: StageInput['mediaType'] = 'image/png',
): StageInput {
  return {
    base64,
    mediaType,
    alt: 'A blue two by three image',
    provenance: { source: 'local-test', license: 'Test-authored' },
  };
}

/**
 * Asserts a result succeeded and returns its value.
 *
 * @param result - The result.
 * @returns The success value.
 * @throws When the result failed: Vitest's assertion error from `expect(result.ok).toBe(true)`,
 * thrown first, so the `Error` with the failure's message below is not reached. Vitest reports it
 * as the test's failure.
 */
export function value<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Asserts a result failed with the given code. Messages are not asserted.
 *
 * @param result - The result.
 * @param code - The expected failure code.
 * @throws Vitest's assertion error when the result succeeded or has another code. Vitest reports
 * it as the test's failure.
 */
export function rejects(
  result: Result<unknown>,
  code: ErrorCode,
): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

/**
 * Builds a `storage-unavailable` failure at `fixture`, for providers that fail on purpose.
 *
 * @returns A new failure on every call.
 * @throws Never.
 */
export function unavailable<T>(): Result<T> {
  return {
    ok: false,
    error: {
      code: 'storage-unavailable',
      path: 'fixture',
      message: 'Unavailable',
      recovery: 'Retry fixture',
    },
  };
}

/**
 * Wraps a media registry so every processor waits for `pause` before normalizing. Tests use it to
 * release a lease while staging is still waiting.
 *
 * @param media - The real registry.
 * @param pause - Resolves when processing may continue.
 * @returns The delayed registry. Detection is not delayed.
 * @throws Never. A processor's promise rejects when `pause` rejects (the handler is not called)
 * or when the real handler rejects or throws. Staging's own boundary turns that into a failure.
 */
export function delayedMedia(
  media: MediaRegistry,
  pause: Promise<void>,
): MediaRegistry {
  return {
    detect: media.detect,
    // One delayed processor per real processor, for the same media types.
    handlers: media.handlers.map((handler) => ({
      mediaTypes: handler.mediaTypes,
      /** Waits for `pause`, then runs the real processor. */
      normalize: async (base64, declared) => {
        await pause;
        return handler.normalize(base64, declared);
      },
    })),
  };
}
