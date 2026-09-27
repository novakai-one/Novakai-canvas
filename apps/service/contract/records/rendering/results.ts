import { failureSource } from '../transport/failure-source.js';
import { z } from 'zod';
/** Versioned transport errors are host-owned; owner-specific detail is reported before encoding this boundary. */
export const diagnostic = z
  .strictObject({
    code: z.enum([
      'invalid-input',
      'unauthorized',
      'not-found',
      'unavailable',
      'conflict',
      'cancelled',
    ]),
    path: z.string(),
    message: z.string(),
    recovery: z.string(),
    source: failureSource.optional(),
  })
  .readonly();
/** An unknown success payload acquires its domain type only after owner decoding. */
export const resultEnvelope = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: diagnostic }),
]);
