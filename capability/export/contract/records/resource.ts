/*
 * One transferred resource blob (an asset, preset or font) with its digest and the owner's
 * metadata. A snapshot carries these for encoding; a bundle carries them as base64. The owners
 * check them, not Export. Declarations only; `resourceKind` is the one runtime schema.
 */
import { z } from 'zod';

/** The kind of a transferred resource: `asset`, `preset` or `font`. */
export const resourceKind = z.enum(['asset', 'preset', 'font']);

/** One transferred blob with its identity and the owner's metadata. */
export interface Resource {
  /** Which owner checks it: `asset`, `preset` or `font`. */
  readonly kind: z.infer<typeof resourceKind>;

  /** SHA-256 of `bytes`, as 64 lowercase hex characters (no `sha256:` prefix). */
  readonly digest: string;

  /** The blob's media type, for example `image/png` or `font/woff2`. */
  readonly mediaType: string;

  /** The blob's exact bytes. */
  readonly bytes: Uint8Array;

  /** The owner's metadata, a JSON record. The owner validates it, not Export. */
  readonly metadata: Readonly<Record<string, unknown>>;
}
