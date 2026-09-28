import { AuthoringFault, failure, diagnosticSchema } from '../../contract/errors.js';
import type { Diagnostic, ErrorCode, Result } from '../../contract/errors.js';

/**
 * Stops the current Authoring operation with a typed rejection.
 *
 * The rejection travels as an `AuthoringFault` until the public boundary (`protect`) turns it
 * back into a failed `Result`. No partial candidate is ever returned to the caller.
 *
 * @param code - The error code to report.
 * @param path - The field that caused the rejection. It is also reported as the only target.
 * @param message - A human-readable explanation.
 * @returns Never returns.
 * @throws AuthoringFault always, carrying the diagnostic built from the arguments.
 */
export function reject(
  code: ErrorCode,
  path: string,
  message: string,
): never {
  const rejection = failure<never>(code, path, message, [path]);
  return accepted(rejection);
}

/**
 * Returns the value of a successful `Result`, or stops the operation with its diagnostic.
 *
 * Use it only inside an operation guarded by `protect`. A collaborator's diagnostic is copied and
 * checked first, so the code and path it reported reach the caller unchanged.
 *
 * @param result - The result to unwrap.
 * @returns The result's value when it succeeded.
 * @throws AuthoringFault with a copy of the result's diagnostic when it failed.
 * @throws AuthoringFault `corrupt-record` when the failed result's diagnostic is malformed.
 */
export function accepted<T>(result: Result<T>): T {
  if (!result.ok) throw new AuthoringFault(copyDiagnostic(result.error));
  return result.value;
}

/**
 * Freezes a value and everything inside it, so no later code can change it.
 *
 * Only copied plain data is passed here. Live infrastructure objects, such as leases and
 * services, are never frozen.
 *
 * @param value - The value to freeze. It is frozen in place.
 * @returns The same value, now deeply frozen. Values that are not objects are returned as they are.
 *   An object that is already frozen is returned without looking inside it. This assumes it was
 *   frozen by this function, which freezes everything inside first.
 */
export function freeze<T>(value: T): T {
  if (!isObject(value)) return value;
  // Values are frozen from the bottom up, so an already frozen object is frozen all the way down.
  if (Object.isFrozen(value)) return value;
  Object.values(value).forEach((child) => freeze(child));
  return Object.freeze(value);
}

/**
 * Turns an error caught at the public boundary into a failed `Result`.
 *
 * - An `AuthoringFault` keeps its own diagnostic.
 * - Any other error becomes `storage-unavailable`, tagged with the request's trace ID.
 *   Its message and stack are not exposed. Authoring owns the retry.
 *
 * @param error - The caught error.
 * @param traceId - The trace ID that links the failure to its request.
 * @returns A failed result.
 */
export function boundaryFailure<T>(
  error: unknown,
  traceId: string,
): Result<T> {
  if (error instanceof AuthoringFault) return { ok: false, error: error.diagnostic };
  return {
    ok: false,
    error: {
      code: 'storage-unavailable',
      path: 'provider',
      targets: [],
      message: 'An authoring collaborator failed unexpectedly',
      recovery: 'Retain the draft and reconcile the same request receipt before retry.',
      traceId,
    },
  };
}

/**
 * Runs an Authoring operation at the public boundary and returns its outcome as a `Result`.
 *
 * Every error the operation throws, synchronously or asynchronously, becomes a failed result.
 * Both successful and failed results are deeply frozen.
 *
 * @param operation - The operation to run.
 * @param traceId - The trace ID used when an unexpected error must be reported.
 * @returns The operation's value as a successful result, or the failure it raised.
 */
export async function protect<T>(
  operation: () => Promise<T>,
  traceId: string,
): Promise<Result<T>> {
  try {
    const value = await operation();
    return freeze({ ok: true, value });
  } catch (error) {
    return freeze(boundaryFailure(error, traceId));
  }
}

/** Tells whether a value is a non-null object. Arrays count as objects. */
function isObject<T>(value: T): value is T & object {
  return typeof value === 'object' && value !== null;
}

/**
 * Makes Authoring's own checked copy of a collaborator's diagnostic.
 * A malformed diagnostic is replaced by a `corrupt-record` rejection.
 */
function copyDiagnostic(input: unknown): Diagnostic {
  const parsed = diagnosticSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  // Built with `failure` instead of `reject`, so the rejection keeps an empty target list.
  const malformed = failure<never>(
    'corrupt-record',
    'diagnostic',
    'Provider returned an invalid diagnostic',
  );
  return accepted(malformed);
}
