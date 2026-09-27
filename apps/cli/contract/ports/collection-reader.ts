/*
 * Model's check of one stored collection record. Declaration only; compose binds Model's
 * `validate`. Pure: the caller decides what an invalid collection means.
 */
import type { Collection, ModelResult } from '../records/foreign.js';

/** Checks a stored collection value with Model. */
export interface CollectionReader {
  /** The collection, or Model's `validation-failed` diagnostics. */
  validate(value: unknown): ModelResult<Collection>;
}
