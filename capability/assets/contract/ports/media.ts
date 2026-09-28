import type { Result } from '../errors.js';
import type { NormalizedMedia, SupportedMedia } from '../records/media.js';

/**
 * A media processor for some media types. It checks and normalizes bytes within the admission
 * limits. It never commits bindings and never fetches external resources. Processors can be
 * swapped or added without changing the staging steps.
 */
export interface MediaHandler {
  /** The media types this processor handles. Staging uses the first processor that lists one. */
  readonly mediaTypes: readonly SupportedMedia[];
  /**
   * Checks and normalizes one media file.
   *
   * @param base64 - The bytes, base64 encoded.
   * @param declared - The media type the bytes should have.
   * @returns The normalized media (Assets checks it again), or `unsupported-media` /
   * `unsafe-media` when the bytes are refused.
   * @throws The built-in processors never throw or reject. A throw or rejection from another one
   * becomes `unsafe-media` at `$`.
   */
  normalize(
    base64: string,
    declared: SupportedMedia,
  ): Promise<Result<NormalizedMedia>>;
}

/** The registered media processors, plus detection of a media type from bytes. */
export interface MediaRegistry {
  /** The processors, in the order staging searches them. */
  readonly handlers: readonly MediaHandler[];
  /**
   * Detects the media type from the bytes' signature. Restoring a backup uses this instead of any
   * type the backup claims.
   *
   * @param base64 - The bytes, base64 encoded.
   * @returns The detected type, or a failure (the built-in detector returns `unsupported-media`
   * for an unknown signature and `invalid-input` for bytes it cannot decode).
   * @throws The built-in detector never throws. A throw from another one becomes `unsafe-media`
   * at `$`.
   */
  detect(base64: string): Result<SupportedMedia>;
}
