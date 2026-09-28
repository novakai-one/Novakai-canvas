import { CanvasFault, type Result, type ErrorCode } from '../../contract/errors.js';
/** Private structured failure; Canvas facade retains caller state and host owns correction/retry. */
export function reject(
  code: ErrorCode,
  path: string,
  message: string,
): never {
  throw new CanvasFault({
    code,
    path,
    targets: [path],
    message,
    recovery: 'Host retains the current scene and draft; correct the named input before retrying.',
  });
}
/** Read a checked collaborator outcome; public Canvas boundary owns recovery. */
export function accepted<T>(result: Result<T>): T {
  if (!result.ok) throw new CanvasFault(result.error);
  return result.value;
}
/** Preserve typed failure data; unexpected providers never expose native exception text. */
export function failure(error: unknown): Result<never> {
  if (error instanceof CanvasFault) return { ok: false, error: error.detail };
  return {
    ok: false,
    error: {
      code: 'provider-failure',
      path: 'canvas',
      targets: [],
      message: 'Canvas operation failed',
      recovery: 'Host retains the previous scene; repair the provider and retry.',
    },
  };
}
/** Typed boundary catches every provider/input error without changing the caller-owned state. */
export function protect<T>(run: () => T): Result<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return failure(error);
  }
}
/** Explicit asynchronous composition failure; host preserves existing bindings and owns recovery. */
export async function protectAsync<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return failure(error);
  }
}
interface Reader<T> {
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
/** Structural reader role keeps Zod out of core; diagnostics identify the failing public field. */
export function parse<T>(
  reader: Reader<T>,
  input: unknown,
): T {
  const result = reader.safeParse(input);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  return reject(
    'invalid-input',
    first?.path.join('.') ?? 'input',
    first?.message ?? 'Invalid input',
  );
}
