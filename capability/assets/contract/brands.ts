import { z } from 'zod';

/**
 * Checks a SHA-256 content digest: 64 lowercase hex characters. It names exact bytes: a stored
 * asset's normalized bytes, or the submitted bytes (`Admission.originalDigest`). Metadata such as
 * a file name or alt text never locates bytes.
 */
export const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'Digest'>();

/** Checks a lease ID: a UUID. A lease protects a set of digests from collection. */
export const leaseId = z.uuid().brand<'LeaseId'>();

/** A digest that passed {@link digest}. */
export type Digest = z.infer<typeof digest>;

/** A lease ID that passed {@link leaseId}. */
export type LeaseId = z.infer<typeof leaseId>;
