/*
 * Why this file exists
 *
 * Many CLI steps build one thing from other steps that can each fail. `render:png` needs both a
 * collection and an output folder. If either was typed wrong, it must stop with that mistake, not
 * carry on with half a request.
 *
 * This file joins steps' `Result`s (`Success` or `Failure`, see `contract/errors.ts`): all the
 * values, or the first failure, unchanged. The failure type is `CliFailure` unless a caller names
 * another. It never makes up a value for a step that failed.
 */
import type { CliFailure, Failure, LocalFailure, Result, Success } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** Gives back every step's value, in order, or the first failure. */
export function combined<T, E = CliFailure>(
  results: readonly Result<T, E>[],
): Result<readonly T[], E> {
  const firstFailure = results.find(isFailure);
  if (firstFailure !== undefined) {
    return firstFailure;
  }
  const workedSteps = results.filter(isSuccess);
  const stepValues = workedSteps.map(stepValue);
  return success(stepValues);
}

/** Makes a new value, with `make`, from a step that worked. A failed step is passed on unchanged. */
export function mapped<T, U, E = CliFailure>(
  result: Result<T, E>,
  make: (value: T) => U,
): Result<U, E> {
  if (!result.ok) {
    return result;
  }
  const made = make(result.value);
  return success(made);
}

/**
 * Makes one value, with `make`, from two steps that both worked. Otherwise gives back the first
 * failure, checking `first` before `second`.
 */
export function joined<A, B, T>(
  first: Result<A>,
  second: Result<B>,
  make: (first: A, second: B) => T,
): Result<T> {
  if (!first.ok) {
    return first;
  }
  if (!second.ok) {
    return second;
  }
  const made = make(first.value, second.value);
  return success(made);
}

/**
 * Gives back `invalid-command` for a case a `switch` should never reach. Its `never` parameter
 * makes the compiler prove every case is handled, so in practice it never runs.
 */
export function unsupported(value: never): Result<never> {
  // Marks the parameter as used: it is there only so the compiler checks every case is handled.
  void value;
  return unsupportedCommandFailure();
}

/** Whether the step found a mistake. */
function isFailure<T, E>(step: Result<T, E>): step is Failure<E> {
  return !step.ok;
}

/** Whether the step worked. */
function isSuccess<T, E>(step: Result<T, E>): step is Success<T> {
  return step.ok;
}

/** What a step that worked made. */
function stepValue<T>(step: Success<T>): T {
  return step.value;
}

/** Makes the mistake for a command no case handles (`invalid-command`). */
function unsupportedCommandFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-command', message: 'Unsupported command' });
}
