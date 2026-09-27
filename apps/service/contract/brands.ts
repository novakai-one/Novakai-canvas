/*
 * Service's checked identities. The service mints a transport generation when it starts
 * (`adapters/runtime/local-credentials.ts`) and stamps it on every envelope; a client that kept an
 * older generation rereads and reconciles its receipts first. Declarations only; nothing to
 * recover. A value this schema rejects is `invalid-input` to whoever parsed it.
 */
import { z } from 'zod';

/**
 * Checks and brands a transport generation: 1 to 128 characters, the same rule as the envelope
 * schemas in `records/protocol.ts`. Use `safeParse`; `parse` throws a `ZodError`.
 */
export const transportGeneration = z.string().min(1).max(128).brand<'TransportGeneration'>();

/** A transport generation checked by {@link transportGeneration}. */
export type TransportGeneration = z.infer<typeof transportGeneration>;
