import { fail, ProjectionFault } from '../../contract/errors.js';
import type { ErrorCode, Result } from '../../contract/errors.js';
interface Parser<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}
/** Private stages unwrap typed failures into the public projection/render boundary, never to external callers. */
export function requireValue<T>(result: Result<T>): T {
  if (!result.ok) throw new ProjectionFault(result.error);
  return result.value;
}
/** Raise a structured private failure; public protect owns recovery and preserves the committed diagram. */
export function reject(
  code: ErrorCode,
  path: string,
  message: string,
): never {
  const result = fail<never>(code, path, message);
  return requireValue(result);
}
/** Parse known boundary records; never cast untrusted data into rendering props. */
export function parse<T>(
  schema: Parser<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  return reject(
    'invalid-input',
    issue?.path.map(String).join('.') ?? '$',
    issue?.message ?? 'Invalid visual input',
  );
}
/** Snapshot copy rejects cyclic/oversized source before domain reading; semantic validity remains Model-owned. */
export function clone<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return reject('invalid-input', '$', 'Expected JSON input');
  if (new TextEncoder().encode(encoded).byteLength > 16 * 1024 * 1024)
    return reject('limit', '$', 'Input exceeds 16 MiB');
  return structuredClone(value);
}
/** Only detached output is frozen; native font/provider objects are never recursively frozen. */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
/** Typed read boundary; Authoring retains committed state and callers correct input or restore the named resource. */
export function protect<T>(action: () => T): Result<T> {
  try {
    return { ok: true, value: freeze(action()) };
  } catch (error) {
    return caught(error);
  }
}
/** Diagnostic identity survives private stages; unknown provider exceptions never leak raw messages. */
function caught<T>(error: unknown): Result<T> {
  if (error instanceof ProjectionFault) return { ok: false, error: error.diagnostic };
  return fail('provider-failed', '$', 'Presentation provider failed');
}
