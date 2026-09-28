import { z } from 'zod';
import { requestId, actorId, timestamp, workspaceId } from '../brands.js';
import { keySchema, storedSchema, versionSchema } from './storage.js';

/**
 * Makes a parsed record read-only at every depth: every field and every array. This changes types
 * only; parsed objects are not frozen by it.
 */
type ReadonlyDeep<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> };

/**
 * One record's change inside a transaction: its image before and after.
 * Images keep their resources even when the current record has been deleted.
 * `before` is `null` when the record did not exist.
 */
export const transitionSchema = z.strictObject({
  key: keySchema,
  before: storedSchema.nullable(),
  after: storedSchema,
});

/**
 * A stored transaction: who changed what, when, and how.
 * `mode` is `change` for an original change; `target` names the original change for an undo or redo.
 *
 * This checks structure only. The schema does not tie `target` to `mode`; history reading checks
 * that the records it points to exist and agree.
 */
export const transactionSchema = z.strictObject({
  kind: z.literal('transaction'),
  id: requestId,
  actor: z.strictObject({ id: actorId, kind: z.enum(['human', 'agent']) }),
  timestamp,
  mode: z.enum(['change', 'undo', 'redo']),
  label: z.string().optional(),
  target: requestId.nullable(),
  transitions: z.array(transitionSchema).min(1),
});

/**
 * The current state of one original change: whether it is `active` or `undone`, the current
 * versions of the records it touches, and the last request that acted on it.
 */
export const headSchema = z.strictObject({
  kind: z.literal('head'),
  original: requestId,
  state: z.enum(['active', 'undone']),
  participants: z.array(versionSchema).min(1),
  last: requestId,
});

/** A stored transaction. */
export type Transaction = ReadonlyDeep<z.infer<typeof transactionSchema>>;

/** The current state of one original change. */
export type HistoryHead = ReadonlyDeep<z.infer<typeof headSchema>>;

/**
 * Undo/redo navigation, stored separately from the transactions it points to.
 *
 * This checks structure only. `readNavigation` checks the meaning: the cursor is within `actions`,
 * every action's history exists, and the frontier matches the snapshot.
 *
 * - `actions`: the original changes in order.
 * - `cursor`: how many of them are active; steps before it can be undone, the step at it can be redone.
 * - `frontier`: the current version of every content record.
 * - `baselineSequence`: the storage sequence when history was adopted.
 */
export const navigationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baselineSequence: z.number().int().nonnegative(),
  actions: z.array(requestId),
  cursor: z.number().int().nonnegative(),
  frontier: z.array(versionSchema),
});

/**
 * The next undo or redo a client can submit: its label, actor and scope, plus the exact
 * `expected` versions to send with it.
 */
export const historyActionSchema = z.strictObject({
  transaction: requestId,
  label: z.string(),
  actor: transactionSchema.shape.actor,
  collections: z.array(z.string()),
  scope: z.array(keySchema),
  expected: z.array(versionSchema),
});

/** A workspace's undo/redo status. `undo` or `redo` is `null` when there is nothing to undo or redo. */
export const historyStatusSchema = z.strictObject({
  workspace: workspaceId,
  navigationVersion: versionSchema,
  undo: historyActionSchema.nullable(),
  redo: historyActionSchema.nullable(),
});

/** Undo/redo navigation. */
export type HistoryNavigation = ReadonlyDeep<z.infer<typeof navigationSchema>>;

/** The next undo or redo a client can submit. */
export type HistoryAction = ReadonlyDeep<z.infer<typeof historyActionSchema>>;

/** A workspace's undo/redo status. */
export type HistoryStatus = ReadonlyDeep<z.infer<typeof historyStatusSchema>>;
