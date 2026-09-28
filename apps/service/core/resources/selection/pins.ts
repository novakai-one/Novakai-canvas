/*
 * Why this file exists
 *
 * The themes and files picked at preview must be the ones used at save. So Authoring keeps the
 * pick with the change as plain JSON (`{ resources }`), and at save the DSL planner picks again
 * and compares. For example, if a newer `paper` theme was saved in between, a change that says
 * `theme=paper` picks differently the second time, and the save is refused.
 *
 * This file writes a pick as that JSON, and compares two of them value by value, in any key
 * order. It never changes either one.
 */
import type {
  AuthoringResult,
  Json,
  ResolvedResources,
} from '../../../contract/records/capability-types.js';
import { json } from '../../../contract/schemas.js';
import { success } from '../../../contract/errors.js';
import { unreadableRequestFailure } from './refusal.js';

/**
 * Writes the picked themes and files as plain JSON: `{ resources }`. Fails with `invalid-input` at
 * `resources` when they can't be written as JSON.
 */
export function toResourcesJson(resources: ResolvedResources): AuthoringResult<Json> {
  const pins = json.safeParse({ resources });
  if (!pins.success) return unreadableRequestFailure();
  return success(pins.data);
}

/**
 * Whether two picks written by `toResourcesJson` hold the same values: arrays with the same items
 * in the same order, objects with the same keys in any order. Never fails.
 */
export function sameResourcesJson(
  kept: Json,
  pickedAgain: Json,
): boolean {
  return sameJson(kept, pickedAgain);
}

/** A JSON object. */
type JsonRecord = { readonly [key: string]: Json };

/** Whether two JSON values are equal (see `sameResourcesJson`). */
function sameJson(
  left: Json,
  right: Json,
): boolean {
  if (isJsonArray(left)) return sameArray(left, right);
  if (isJsonRecord(left)) return sameRecord(left, right);
  return left === right;
}

/** Whether `right` is an array of the same length whose items equal `left`'s, in order. */
function sameArray(
  left: readonly Json[],
  right: Json,
): boolean {
  if (!isJsonArray(right)) return false;
  return left.length === right.length && left.every((item, index) => sameItem(item, right[index]));
}

/** Whether `right` is an object with exactly `left`'s keys, each holding an equal value. */
function sameRecord(
  left: JsonRecord,
  right: Json,
): boolean {
  if (!isJsonRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameItem(left[key], right[key]))
  );
}

/**
 * Whether two looked-up values are present and equal. JSON holds no `undefined`, so a missing key
 * or index never equals a present one.
 */
function sameItem(
  left: Json | undefined,
  right: Json | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  return sameJson(left, right);
}

/** Whether a JSON value is an array. */
function isJsonArray(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

/** Whether a JSON value is an object (not an array and not `null`). */
function isJsonRecord(value: Json): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
