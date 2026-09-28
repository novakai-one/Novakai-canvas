import { TokenFault, type Result, type ErrorCode } from '../../contract/errors.js';
/** Reject one invalid token boundary; public Design System operations own recovery. */
export function reject(
  code: ErrorCode,
  path: string,
  expected: string,
  message: string,
): never {
  throw new TokenFault({
    code,
    path,
    targets: [path],
    expected,
    message,
    recovery: 'Keep the last valid scope; correct the named input and resolve again.',
  });
}
/** Turn a private checked outcome into structured control flow; facade owns recovery. */
export function accepted<T>(result: Result<T>): T {
  if (!result.ok) throw new TokenFault(result.error);
  return result.value;
}
/** Freeze only detached data; callers retain ownership of supplied objects. */
function freezeData(value: unknown): void {
  if (value === null) return;
  if (typeof value !== 'object') return;
  Object.values(value).forEach(freezeData);
  Object.freeze(value);
}
/** Catch all input/provider failures; host retains the old valid scope and owns retry. */
export function protect<T>(operation: () => T): Result<T> {
  try {
    const value = operation();
    freezeData(value);
    return Object.freeze({ ok: true, value });
  } catch (error) {
    return failure(error);
  }
}
/** Preserve domain diagnostics without leaking native exception messages or partially resolved data. */
function failure(error: unknown): Result<never> {
  if (error instanceof TokenFault) return { ok: false, error: error.detail };
  return {
    ok: false,
    error: {
      code: 'provider-failure',
      path: '',
      targets: [],
      expected: 'Readable input and successful provider',
      message: 'Token operation could not complete',
      recovery: 'Host retains the old scope; repair input/provider and retry.',
    },
  };
}

/** Explicit async binding failures are typed; host keeps prior resources and owns retry. */
export async function protectAsync<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await operation();
    freezeData(value);
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}
