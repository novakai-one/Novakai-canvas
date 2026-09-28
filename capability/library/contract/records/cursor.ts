/*
 * The decoded form of a paging cursor. Library-internal: the package index does not export it, and
 * hosts treat the cursor string as opaque. A cursor this schema rejects is `invalid-cursor`; the host
 * searches again without a cursor. Authoring owns commit and recovery.
 */
import { z } from 'zod';
import { nonnegativeIntegerSchema } from '../brands.js';

/** A decoded cursor: the next hit's offset and the keys of the query and sources it belongs to. */
export interface CursorEnvelope {
  /** The offset of the next page's first hit. */
  readonly offset: number;
  /** JSON of the request without its cursor, and the sorted recent visits. */
  readonly queryKey: string;
  /** JSON of the snapshot's source revisions. */
  readonly versionKey: string;
}

/**
 * Builds the schema of a decoded cursor: a whole-number offset from 0 and the two keys. Unknown
 * keys are rejected.
 */
export function cursorSchema(): z.ZodType<CursorEnvelope> {
  return z
    .strictObject({
      offset: nonnegativeIntegerSchema(),
      queryKey: z.string(),
      versionKey: z.string(),
    })
    .readonly();
}
