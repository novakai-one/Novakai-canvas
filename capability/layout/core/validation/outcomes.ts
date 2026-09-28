import { LayoutFault, failure } from '../../contract/errors.js';
import type { Result, ErrorCode } from '../../contract/errors.js';
interface Parser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}
/** Private helpers raise one structured fault; public protect/execute own caller recovery. */
export function reject(
  code: ErrorCode,
  path: string,
  message: string,
  targets: readonly string[] = [],
): never {
  const result = failure<never>(code, path, message, targets);
  return requireValue(result);
}
/** Consume a typed provider result without losing its diagnostic identity; only protected flows call this helper. */
export function requireValue<T>(result: Result<T>): T {
  if (!result.ok) throw new LayoutFault(result.error);
  return result.value;
}
/** Read only checked records from public/native boundaries; first invalid field is identified for correction. */
export function parse<T>(
  schema: Parser<T>,
  input: unknown,
): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return reject(
    'invalid-input',
    issue?.path.map(String).join('.') ?? '$',
    issue?.message ?? 'Invalid layout input',
  );
}
/** Bounded detached JSON snapshot prevents caller changes during async native derivation. */
export function snapshot(value: unknown): unknown {
  const encoded = encodeInput(value);
  if (encoded === undefined) return reject('invalid-input', '$', 'Layout requires JSON data');
  if (new TextEncoder().encode(encoded).byteLength > 16 * 1024 * 1024)
    return reject('limit', '$', 'Layout input exceeds 16 MiB');
  return JSON.parse(encoded);
}
/** Serialization failures are input failures, not an invented native engine fault. */
function encodeInput(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, checkedJsonValue);
  } catch {
    return reject('invalid-input', '$', 'Layout input must be finite, acyclic JSON data');
  }
}
/** JSON must not silently turn NaN/infinity into null or discard functions and symbols. */
function checkedJsonValue(
  _key: string,
  value: unknown,
): unknown {
  if (typeof value === 'number' && !Number.isFinite(value))
    return reject('invalid-input', '$', 'Nonfinite geometry is not JSON data');
  return serializable(value);
}
/** Optional undefined fields follow normal JSON omission; callable and symbolic values are rejected. */
function serializable(value: unknown): unknown {
  if (typeof value === 'function' || typeof value === 'symbol')
    return reject('invalid-input', '$', 'Callable/symbolic values are not JSON data');
  return value;
}
/** Freeze detached values only; no native solver/router/provider instances enter this recursive boundary. */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
/** Preserve known private failures; native exceptions remain engine-failed without leaking provider messages. */
function caught<T>(error: unknown): Result<T> {
  if (error instanceof LayoutFault) return { ok: false, error: error.diagnostic };
  return failure('engine-failed', '$', 'Layout provider failed');
}
/** Synchronous inspection is replayable; Authoring retains committed state and exposes typed correction. */
export function protect<T>(action: () => T): Result<T> {
  try {
    return { ok: true, value: freeze(action()) };
  } catch (error) {
    return caught(error);
  }
}
/** Async derivation is atomic from the caller's view; host retains previous scene/draft on any failure. */
export async function execute<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: freeze(await action()) };
  } catch (error) {
    return caught(error);
  }
}
