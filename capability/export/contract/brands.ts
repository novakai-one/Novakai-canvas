/*
 * Identifier and digest schemas used by Export's records. They are plain string checks, not
 * branded types. The exported schemas are shared, unfrozen objects; their `parse` throws a
 * `ZodError`. Checking a value has no side effects, so it can be repeated freely.
 */
import { z } from 'zod';

/**
 * A transferred identifier: 1–120 UTF-16 code units (zod counts `.length`). It keeps the
 * collection-local ID as written; Export never creates domain identities.
 */
export const identity: z.ZodString = z.string().min(1).max(120);

/** A SHA-256 digest: exactly 64 lowercase hex characters. */
export const digest: z.ZodString = z.string().regex(/^[a-f0-9]{64}$/);
