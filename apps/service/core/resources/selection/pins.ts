/*
 * The pins record a selection answers: its resolved resources as plain JSON, which Authoring keeps
 * on the lease and hands back to the DSL planner. The planner repeats the selection and compares
 * both records value by value. Pure; a record that is not JSON is `invalid-input` at `resources`
 * (refusal.ts), and Authoring owns recovery.
 */
import type {
  AuthoringResult,
  Json,
  ResolvedResources,
} from '../../../contract/records/capabilities.js';
import { json } from '../../../contract/schemas.js';
import { success } from '../../../contract/errors.js';
import { undecodable } from './refusal.js';

/**
 * The pins record for these resources: `{ resources }` checked as JSON. Fails with
 * `invalid-input` at `resources` when the resources are not JSON.
 */
export function selectionPins(resources: ResolvedResources): AuthoringResult<Json> {
  const pins = json.safeParse({ resources });
  if (!pins.success) return undecodable();
  return success(pins.data);
}

/**
 * Whether two pins records hold the same values: equal scalars, arrays with equal items in the
 * same order, and objects with the same keys holding equal values, in any key order. Never fails.
 */
export function samePins(
  admitted: Json,
  selected: Json,
): boolean {
  return sameJson(admitted, selected);
}

/** A JSON object. */
type JsonRecord = { readonly [key: string]: Json };

/** Whether two JSON values are equal (see `samePins`). */
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
