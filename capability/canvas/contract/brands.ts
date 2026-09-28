/*
 * Canvas's checked session identifiers and scalars. Declarations only; nothing to recover. Input
 * these schemas refuse becomes an `invalid-input` diagnostic, and the host corrects it.
 */
import { z } from 'zod';
/** Session identifiers are checked strings; semantic identity remains with Model. */
export const identity = z.string().min(1).max(500);
export const coordinate = z.number().finite().min(-1000000).max(1000000);
export const dimension = z.number().finite().positive().max(1000000);
export const generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/**
 * One gesture's identity. The host supplies random text; Canvas parses it when the gesture begins
 * (`adapters/react-flow/gesture-ids.ts`). Every event, draft, intent and recovery entry of that
 * gesture carries it.
 */
export const gestureId = identity.brand<'GestureId'>();
/** A gesture identity that passed {@link gestureId}. */
export type GestureId = z.infer<typeof gestureId>;
