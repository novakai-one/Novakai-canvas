import { fail } from '../../contract/errors.js';
import type { ErrorCode, Result } from '../../contract/errors.js';

/** The part of a zod schema that `parse` uses. */
interface Parser<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}

/**
 * Wraps a value as a success. The value is not copied or frozen here; callers pass parsed or
 * newly built values, and the public boundary (`protect` / `protectAsync`) freezes them.
 *
 * @param value - The success value.
 * @returns `{ ok: true, value }`.
 * @throws Never.
 */
export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Checks input with a schema and returns a typed result, without casting.
 *
 * @param schema - The schema to check with (its `safeParse` is read and called once).
 * @param input - The value to check.
 * @param code - The failure code. Defaults to `invalid-input`; stored data uses `corrupt-asset`
 * and processor output uses `unsafe-media`.
 * @returns The parsed data, or a failure built from the first issue: its path joined with `.`
 * (an issue at the root gives the empty path `""`; `$` when there is no issue) and its message
 * ("Invalid data" when there is no issue).
 * @throws Whatever the schema throws. Zod's `safeParse` rethrows an error raised while reading the
 * input (for example a throwing getter); `protect` / `protectAsync` turn it into a failure.
 */
export function parse<T>(
  schema: Parser<T>,
  input: unknown,
  code: ErrorCode = 'invalid-input',
): Result<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return success(parsed.data);
  }
  const issue = parsed.error.issues[0];
  return fail(code, issue?.path.map(String).join('.') ?? '$', issue?.message ?? 'Invalid data');
}

/**
 * The public boundary of synchronous Assets operations. Runs `action` and deep-freezes its
 * result. A throw becomes a frozen `storage-unavailable` failure at `$`: "Asset operation failed;
 * re-read before retry". Assets owns cleanup; Authoring or the maintenance caller owns retry.
 *
 * @param action - The operation to run.
 * @returns The frozen result, or the frozen failure for a throw.
 * @throws Never.
 */
export function protect<T>(action: () => Result<T>): Result<T> {
  try {
    return freeze(action());
  } catch {
    return freeze(fail('storage-unavailable', '$', 'Asset operation failed; re-read before retry'));
  }
}

/**
 * The public boundary of asynchronous Assets operations (media processing, restores). Awaits
 * `action` and deep-freezes its result. A throw or a rejection becomes a frozen failure with
 * `code` at `$`: "Asset processing failed safely".
 *
 * @param action - The operation to run.
 * @param code - The failure code for a throw. Defaults to `storage-unavailable`.
 * @returns The frozen result, or the frozen failure for a throw.
 * @throws Never (the promise never rejects).
 */
export async function protectAsync<T>(
  action: () => Promise<Result<T>>,
  code: ErrorCode = 'storage-unavailable',
): Promise<Result<T>> {
  try {
    return freeze(await action());
  } catch {
    return freeze(fail(code, '$', 'Asset processing failed safely'));
  }
}

/**
 * Deep-freezes a value in place and returns it. Public bytes are base64 strings, so results hold
 * no typed arrays (which cannot be frozen). Functions are left unfrozen, for example a lease's
 * `read` and `release`; the objects holding them are frozen.
 *
 * @param value - The value to freeze. Primitives and functions are returned unchanged.
 * @returns The same value, frozen at every object level.
 * @throws Never for plain data.
 */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
