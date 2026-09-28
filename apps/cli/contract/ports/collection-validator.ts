/*
 * Why this file exists
 *
 * The service sends back saved collections as plain data. `list` prints one line per collection,
 * and a collection that isn't valid must show as invalid, not pass for a good one. Only Model can
 * say whether a collection is valid.
 *
 * This file names that one check, so core can ask Model without importing it. It only checks; the
 * caller decides what an invalid collection means.
 */
import type { Collection, ModelResult } from '../records/foreign.js';

/** Model's check of a saved collection. */
export interface CollectionValidator {
  /**
   * Checks the data is a valid collection. Gives it back typed, or Model's findings, in Model's
   * own `Result` (the same `ok`, `value` and `error` fields as the CLI's).
   */
  validate(stored: unknown): ModelResult<Collection>;
}
