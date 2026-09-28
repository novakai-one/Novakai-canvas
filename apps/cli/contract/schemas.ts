/*
 * Why this file exists
 *
 * The CLI's checks are written with zod, a checking library, which calls a check a "schema". Core
 * must run checks without importing zod, and a request the CLI sends must pass Authoring's own
 * request check, not a copy that could drift from it.
 *
 * This file passes on Authoring's checks, and names `Parser`, the one thing core uses from any
 * check. Whoever runs a check decides which failure a refusal becomes.
 */

/** Authoring's checks of a save's receipt, a change request, and a workspace snapshot. */
export { receiptSchema, requestSchema, snapshotSchema } from '@novakai/canvas-authoring';

/**
 * Any check core can run. Its `safeParse` (zod's name) gives back the checked value, often as a
 * checked type such as `FilePath`, or says the input failed.
 */
export interface Parser<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}
