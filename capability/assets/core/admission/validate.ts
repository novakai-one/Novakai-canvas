import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import { stageInput, normalizedMedia, limits } from '../../contract/records/media.js';
import type { StageInput, NormalizedMedia } from '../../contract/records/media.js';
import { parse, success } from '../validation/outcomes.js';

/**
 * Computes the decoded byte length of base64 text from its length and trailing `=` padding,
 * without decoding it. The result is correct only for text that passed the `base64` schema (every
 * caller passes checked text); for other text it can be a fraction. The alphabet and canonical
 * form are checked elsewhere (the `base64` schema and the identity adapter).
 *
 * @param base64 - The base64 text.
 * @returns The number of bytes it decodes to.
 * @throws Never.
 */
export function byteLength(base64: string): number {
  const padding = base64.length - base64.replace(/=+$/, '').length;
  return (base64.length * 3) / 4 - padding;
}

/**
 * Checks a staging request before any codec runs, in this order:
 * 1. the `stageInput` schema (`invalid-input` at the issue's path);
 * 2. alt text, required for every type except fonts (`invalid-input` at `alt`);
 * 3. the decoded size, at most {@link limits}.bytes (`invalid-input` at `base64`).
 *
 * @param input - The submitted request.
 * @returns The checked request, or the first failure.
 * @throws Whatever reading the input throws (for example a getter); `stageMedia`'s boundary
 * (`protectAsync`) turns it into `unsafe-media`.
 */
export function validateInput(input: unknown): Result<StageInput> {
  const parsed = parse(stageInput, input);
  if (!parsed.ok) {
    return parsed;
  }
  if (missingAlt(parsed.value)) {
    return fail('invalid-input', 'alt', 'Visual media requires descriptive alt text');
  }
  return checkInputSize(parsed.value);
}

/**
 * Checks a media processor's output, even from an injected processor, in this order:
 * 1. the `normalizedMedia` schema (`unsafe-media` at the issue's path);
 * 2. the decoded size, at most {@link limits}.bytes (`unsafe-media` at `base64`);
 * 3. a font must have a family (`unsafe-media` at `fontFamily`); any other kind must have a width
 *    and height (`unsafe-media` at `dimensions`).
 *
 * @param input - The processor's output.
 * @returns The checked media, or the first failure.
 * @throws Whatever reading the processor output throws; `stageMedia`'s and `prepareRestored`'s
 * boundaries (`protectAsync`) turn it into `unsafe-media`.
 */
export function validateNormalized(input: unknown): Result<NormalizedMedia> {
  const parsed = parse(normalizedMedia, input, 'unsafe-media');
  if (!parsed.ok) {
    return parsed;
  }
  if (byteLength(parsed.value.base64) > limits.bytes) {
    return fail('unsafe-media', 'base64', 'Normalized asset exceeds byte limit');
  }
  return checkMetrics(parsed.value);
}

/** Tells whether visual media is missing alt text. Fonts need none; their family names them. */
function missingAlt(input: StageInput): boolean {
  return !input.mediaType.startsWith('font/') && input.alt.trim().length === 0;
}

/** Rejects submitted bytes over the size limit, before normalization. */
function checkInputSize(input: StageInput): Result<StageInput> {
  if (byteLength(input.base64) > limits.bytes) {
    return fail('invalid-input', 'base64', 'Asset exceeds byte limit');
  }
  return success(input);
}

/** Requires measured width and height for visual media; fonts are checked for a family instead. */
function checkMetrics(media: NormalizedMedia): Result<NormalizedMedia> {
  if (media.kind === 'font') {
    return checkFontMetrics(media);
  }
  if (media.width === null || media.height === null) {
    return fail('unsafe-media', 'dimensions', 'Visual media requires measured dimensions');
  }
  return success(media);
}

/** Requires a font family. A font's width and height may be `null`. */
function checkFontMetrics(media: NormalizedMedia): Result<NormalizedMedia> {
  if (media.fontFamily === null) {
    return fail('unsafe-media', 'fontFamily', 'Font requires a family name');
  }
  return success(media);
}
