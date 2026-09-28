import { jsonValue } from '../../contract/records/storage.js';
import type { Json } from '../../contract/records/storage.js';
import { fail } from '../../contract/errors.js';
import type { ErrorCode, Result } from '../../contract/errors.js';

/** Largest JSON size, in UTF-8 bytes, for a request or a stored workspace state (64 MiB). */
export const JSON_LIMIT = 64 * 1024 * 1024;

/** Largest JSON size, in UTF-8 bytes, for a whole backup bundle with its asset bytes (256 MiB). */
export const BACKUP_JSON_LIMIT = 256 * 1024 * 1024;

/**
 * Wraps a value as a successful result.
 *
 * Recovery from a later failure belongs to the caller: Authoring for commits, the maintenance
 * host for backup and restore.
 *
 * @param value - The successful value.
 * @returns `{ ok: true, value }`.
 */
export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Checks unknown input against a schema and turns a schema failure into a typed failure.
 *
 * The schema's own reads of `input` (for example getters) happen inside `safeParse`; a throw from
 * them propagates to the caller's {@link protect} boundary.
 *
 * The caller chooses the error code: `invalid-input` for submitted requests, `corrupt-record` for
 * stored or restored data. Only the first schema issue is reported. Its path is joined with dots
 * (an empty path gives an empty string); with no issue at all the path is `$` and the message is
 * `Invalid data`. Exception messages are never parsed.
 *
 * @param schema - Any schema with a zod-style `safeParse`.
 * @param input - The value to check.
 * @param code - The error code for a schema failure.
 * @returns The parsed value, or a failure with `code`.
 */
export function parse<T>(
  schema: Parser<T>,
  input: unknown,
  code: ErrorCode,
): Result<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return success(parsed.data);
  }
  const issue = parsed.error.issues[0];
  const path = issue?.path.map(String).join('.') ?? '$';
  const message = issue?.message ?? 'Invalid data';
  return fail(code, path, message);
}

/**
 * Makes a detached, size-checked JSON copy of untrusted input.
 *
 * The input is checked as JSON first, then serialized, measured in UTF-8 bytes, and parsed back.
 * The copy shares nothing with the input, so later changes by the caller cannot reach it.
 *
 * @param input - The value to copy.
 * @param limit - The largest allowed size in UTF-8 bytes. Defaults to {@link JSON_LIMIT}.
 * @returns A new JSON value equal to the input.
 * @throws TypeError when the input is not a JSON value.
 * @throws RangeError when the serialized input is larger than `limit`.
 * Callers run this inside {@link protect}, which turns either throw into a typed failure.
 */
export function boundedClone(
  input: unknown,
  limit = JSON_LIMIT,
): Json {
  const checked = jsonValue.safeParse(input);
  if (!checked.success) {
    throw new TypeError('Unsupported JSON value');
  }
  const serialized = JSON.stringify(checked.data);
  if (new TextEncoder().encode(serialized).length > limit) {
    throw new RangeError('JSON limit');
  }
  // `JSON.parse` is typed `any`; the text was just made from checked JSON, so the result is `Json`.
  // Recorded as open debt (no cast-free way without copying again).
  return JSON.parse(serialized);
}

/**
 * Deep-freezes a value and returns it.
 *
 * Meant for detached JSON results this capability built; caller inputs are never passed here.
 * The walk assumes an object that is already frozen is frozen all the way down (true for values
 * this function froze, since it works bottom-up), so a frozen object's children are not visited.
 * An object frozen only at the top by someone else keeps mutable children.
 * {@link protectAsync} also passes provider-returned results here.
 *
 * @param value - The value to freeze.
 * @returns The same value, frozen.
 */
export function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

/**
 * Runs a synchronous step and turns any throw into a typed failure.
 *
 * This is the error boundary for request and storage reads: a malformed, cyclic or oversized
 * value fails with `code` instead of throwing. The thrown error's message is never exposed.
 *
 * @param action - The step to run.
 * @param code - The error code for a throw. Defaults to `invalid-input`.
 * @returns The step's result, frozen; or, when it throws, a frozen failure with `code`, path `$`
 * and the message `Data or operation could not be read safely`.
 */
export function protect<T>(
  action: () => Result<T>,
  code: ErrorCode = 'invalid-input',
): Result<T> {
  try {
    return freeze(action());
  } catch {
    return freeze(fail(code, '$', 'Data or operation could not be read safely'));
  }
}

/**
 * Runs an asynchronous provider step and turns any throw or rejection into a typed failure.
 *
 * Provider exceptions never escape backup or restore. The outcome is uncertain, so the failure
 * tells the host to inspect the restore destination before retrying.
 *
 * @param action - The step to run.
 * @returns The step's result, frozen; or, when it throws or rejects, a frozen
 * `storage-unavailable` failure with path `$` and the message
 * `Resource operation failed; inspect destination before retry`.
 */
export async function protectAsync<T>(action: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return freeze(await action());
  } catch {
    return freeze(
      fail(
        'storage-unavailable',
        '$',
        'Resource operation failed; inspect destination before retry',
      ),
    );
  }
}

/** The part of a zod schema that {@link parse} uses. */
interface Parser<T> {
  safeParse(input: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly {
            readonly path: readonly PropertyKey[];
            readonly message: string;
          }[];
        };
      };
}
