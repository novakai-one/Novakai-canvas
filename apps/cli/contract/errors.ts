/*
 * Why this file exists
 *
 * When a command goes wrong, the agent must learn what went wrong and what to do next, the same
 * way every time. `pnpm canvas create missing.canvas` prints
 * `source-unavailable: Cannot read UTF-8 source: missing.canvas`, then what to do next.
 *
 * This file holds `Result`: `Success` (it worked, here is the value) or `Failure` (it found a
 * mistake), and the builders that make each failure. A failure is either a mistake the CLI found
 * itself (`LocalFailure`), or a failure record the service package wrote, kept whole
 * (`ForeignFailure`). The CLI's own codes, and the shape each code takes, are listed in
 * `records/local-failure.ts`; they are passed on from here, so every part of the CLI imports its
 * failures from this one file. Code branches on the code, never on the message. Nothing here
 * prints.
 */
import { filePath, type FilePath, type RequestId } from './brands.js';
import type { ServiceFailureRecord } from './records/foreign.js';
import type {
  EvidencedFailure,
  LocalCode,
  LocalFailure,
  LocatedCode,
  LocatedFailure,
  PlainFailure,
  ResourceReadFailure,
  SourceLocation,
} from './records/local-failure.js';
import type { NativeDetail, ProviderFault, RenderFault } from './records/render-fault.js';

export type {
  EvidencedCode,
  EvidencedFailure,
  LocalCode,
  LocalFailure,
  LocatedCode,
  LocatedFailure,
  PlainCode,
  PlainFailure,
  ResourceReadFailure,
  SourceLocation,
} from './records/local-failure.js';

/**
 * A failure record the service package wrote, kept whole in `foreign`: either from the running
 * service, or from the package's reader of the agent's credential file.
 */
export type ForeignCode =
  | 'service-rejected' // The running service answered with a failure.
  | 'credential-unavailable'; // The service package couldn't read the agent's credential file.

/** Every code a CLI failure can carry. */
export type CliFailureCode = LocalCode | ForeignCode;

/** A failure record the service package wrote, kept whole and printed exactly as written. */
export interface ForeignFailure {
  readonly code: ForeignCode;
  readonly foreign: ServiceFailureRecord;
}

/** Any CLI failure: a mistake the CLI found, or a failure record the service package wrote. */
export type CliFailure = LocalFailure | ForeignFailure;

/** A step that worked. `ok` is true and `value` holds what the step made. */
export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

/** A step that found a mistake. `ok` is false and `error` says what went wrong. */
export interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * What every CLI step answers with: it worked, or it found a mistake. Check `ok` to know which.
 * A failure never carries a half-finished value.
 */
export type Result<T, E = CliFailure> = Success<T> | Failure<E>;

/** A mistake to hand to `failure`: a `PlainFailure` whose `recovery` may be left out. */
export type FailureInput = Omit<PlainFailure, 'recovery'> & { readonly recovery?: string };

/** The advice a mistake gets when it names no `recovery` of its own. */
const correctAndRetry = 'Correct the named input and retry.';

/** Wraps a value as a step that worked. */
export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Makes a failed step from a plain mistake the CLI found. If `recovery` is left out, it becomes
 * "Correct the named input and retry."
 */
export function failure(input: FailureInput): Result<never, PlainFailure> {
  const mistake = withRecovery(input);
  return { ok: false, error: mistake };
}

/**
 * Makes the failure the font and image reader gives back when it can't use a file. It has no
 * place yet: the reader doesn't know which declaration asked for the file. Core adds the place
 * with `located`.
 */
export function resourceReadFailure(
  code: LocatedCode,
  message: string,
): Result<never, ResourceReadFailure> {
  const readFailure: ResourceReadFailure = { code, message };
  return { ok: false, error: readFailure };
}

/**
 * Makes a failed step for a font or image the reader couldn't use, naming where the source
 * declares it (`location`). The advice is always "Correct the named input and retry."
 */
export function located(
  readFailure: ResourceReadFailure,
  location: SourceLocation,
): Result<never, LocatedFailure> {
  const mistake: LocatedFailure = {
    code: readFailure.code,
    message: readFailure.message,
    recovery: correctAndRetry,
    location,
  };
  return { ok: false, error: mistake };
}

/**
 * Makes a failed step that keeps why Language, Model or the service refused, in `source`. The
 * fields are copied in the order they are printed: code, message, recovery, source.
 */
export function evidenced(input: EvidencedFailure): Result<never, EvidencedFailure> {
  const mistake: EvidencedFailure = {
    code: input.code,
    message: input.message,
    recovery: input.recovery,
    source: input.source,
  };
  return { ok: false, error: mistake };
}

/**
 * Makes the failure for a source file that can't be read as UTF-8 text (`source-unavailable`).
 * `path` is the path as typed, which may be empty, so it is plain text.
 */
export function unreadableSourceFailure(path: string): Result<never, LocalFailure> {
  return failure({ code: 'source-unavailable', message: `Cannot read UTF-8 source: ${path}` });
}

/**
 * Makes the failure for an `--out` file that can't be written (`output-unavailable`). `path` is
 * the path as typed, which may be empty, so it is plain text.
 */
export function unwritableOutputFailure(path: string): Result<never, LocalFailure> {
  return failure({ code: 'output-unavailable', message: `Cannot write output: ${path}` });
}

/** Makes the failure for a request that fails Authoring's own check (`invalid-input`). */
export function invalidInputFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-input',
    message: 'Request identity or generated preconditions are invalid',
  });
}

/**
 * Makes the failure for an apply answer that doesn't confirm the change was saved
 * (`invalid-response`). It may have been saved, so the advice is to check `request`'s receipt.
 * `message` says what was wrong with the answer, such as "Service returned an invalid receipt".
 */
export function unconfirmedApplyFailure(
  request: RequestId,
  message: string,
): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message,
    recovery: `Check canvas receipt ${request} before retrying.`,
  });
}

/** Makes a failed step from a failure record the service package wrote, without changing it. */
export function foreignFailure(
  code: ForeignCode,
  foreign: ServiceFailureRecord,
): Result<never, ForeignFailure> {
  const kept: ForeignFailure = { code, foreign };
  return { ok: false, error: kept };
}

/** Makes a failed step from one of render:png's own faults. It keeps the fault's exact type. */
export function renderFaultFailure<F extends RenderFault>(fault: F): Result<never, F> {
  return { ok: false, error: fault };
}

/**
 * Makes the `provider-failed` failure for an error thrown by a file, temp-folder or wasm step.
 * Keeps its message, and its path, OS code (such as `ENOENT`) and syscall when well formed.
 */
export function providerFailure(thrown: unknown): Result<never, ProviderFault> {
  const fault: ProviderFault = {
    code: 'provider-failed',
    message: thrownMessage(thrown),
    detail: thrownDetail(thrown),
  };
  return renderFaultFailure(fault);
}

/** The path, OS code and syscall an error may carry, not checked yet. Any of them may be missing. */
type UncheckedDetail = { readonly [Field in keyof NativeDetail]?: unknown };

/** The detail kept when the error carries none, or carries one that isn't well formed. */
const noDetail: NativeDetail = Object.freeze({});

/**
 * Fills in the mistake's `recovery` when it has none. The fields keep their order: code, message,
 * recovery.
 */
function withRecovery(input: FailureInput): PlainFailure {
  const { code, message, recovery = correctAndRetry } = input;
  return { code, message, recovery };
}

/** Gives the thrown error's message, or the thrown thing as text when it isn't an `Error`. */
function thrownMessage(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  return String(thrown);
}

/**
 * Gives the thrown error's path, OS code and syscall, only the ones it has. If any of them isn't
 * well formed, it keeps none, so checked and unchecked details never mix.
 */
function thrownDetail(thrown: unknown): NativeDetail {
  const fields = detailFields(thrown);
  const present = withoutMissingFields(fields);
  if (!isNativeDetail(present)) {
    return noDetail;
  }
  return present;
}

/** Reads the path, OS code and syscall from an error object, under their detail names. */
function detailFields(thrown: unknown): UncheckedDetail {
  if (!isObject(thrown)) {
    return noDetail;
  }
  return {
    path: Reflect.get(thrown, 'path'),
    systemCode: Reflect.get(thrown, 'code'),
    syscall: Reflect.get(thrown, 'syscall'),
  };
}

/** Drops the fields the error didn't have (the ones read as `undefined`). */
function withoutMissingFields(fields: UncheckedDetail): UncheckedDetail {
  const entries = Object.entries(fields);
  const present = entries.filter(isPresentField);
  return Object.fromEntries(present);
}

/** Whether a field read from the error holds something. */
function isPresentField([, content]: readonly [string, unknown]): boolean {
  return content !== undefined;
}

/** Whether the thrown thing is an object, so it may carry fields. */
function isObject(thrown: unknown): thrown is object {
  return typeof thrown === 'object' && thrown !== null;
}

/** Whether each field it has is well formed: a path that isn't empty, a text code, a text syscall. */
function isNativeDetail(fields: UncheckedDetail): fields is NativeDetail {
  return (
    isOptionalPath(fields.path) &&
    isOptionalText(fields.systemCode) &&
    isOptionalText(fields.syscall)
  );
}

/** Whether the field is missing, or is a path that isn't empty. */
function isOptionalPath(field: unknown): field is FilePath | undefined {
  return field === undefined || filePath.safeParse(field).success;
}

/** Whether the field is missing, or is text. */
function isOptionalText(field: unknown): field is string | undefined {
  return field === undefined || typeof field === 'string';
}
