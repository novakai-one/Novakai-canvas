/*
 * Why this file exists
 *
 * When a command goes wrong, the agent must learn what went wrong and what to do next, the same
 * way every time. `pnpm canvas create missing.canvas` prints
 * `source-unavailable: Cannot read UTF-8 source: missing.canvas`, then what to do next.
 *
 * This file holds the fixed list of failure codes, and `Result`: `Success` (it worked, here is the
 * value) or `Failure` (it found a mistake). A failure is either a mistake the CLI found itself
 * (`LocalFailure`), or a failure record the service package wrote, kept whole (`ForeignFailure`).
 * Code branches on the code, never on the message. Nothing here prints.
 */
import { filePath, type FilePath, type RequestId, type ResourceAlias } from './brands.js';
import type {
  FailureSource,
  ServiceFailureRecord,
  SourcePosition,
  ThemeSourceCode,
} from './records/foreign.js';
import type { NativeDetail, ProviderFault, RenderFault } from './records/render-fault.js';

/**
 * A mistake found on this machine, grouped by where it happens. The CLI finds all of them except
 * the last line, `ThemeSourceCode`: Templates' two `.theme` codes, passed on as written.
 */
export type LocalCode =
  // Typed wrong. Nothing was read or sent.
  | 'invalid-command' // No such command.
  | 'invalid-arguments' // A wrong flag, the wrong number of words, or a badly shaped value.
  | 'invalid-mode' // `--mode` isn't create, replace or patch.
  | 'invalid-revision' // `--revision` isn't a whole number from 0 up.
  | 'invalid-server' // `--server` isn't an `http://127.0.0.1` address.
  | 'invalid-request' // A typed request ID isn't one Authoring accepts.
  | 'unknown-profile' // The profile isn't `build-spec@1`.
  // Files on this machine.
  | 'source-unavailable' // A source, font or image file can't be read.
  | 'source-too-large' // The source file is over 16 MiB.
  | 'output-unavailable' // The `--out` file can't be written. The command already ran.
  // The request journal, where a request is saved before it is sent.
  | 'retention-unavailable' // The request couldn't be saved, so it wasn't sent.
  | 'request-unavailable' // The saved request is missing or can't be read.
  | 'request-reused' // The request ID is already saved for a different request.
  | 'journal-corrupt' // The saved file is damaged or holds another ID's request. Nothing was sent.
  // A font or image a source declares. The failure's `location` names the declaration.
  | 'absolute-path' // The path starts at the root of the disk.
  | 'path-escape' // The path leaves the source file's folder.
  | 'unsupported-media' // The file isn't a font or image type the CLI knows.
  | 'resource-mismatch' // A font declaration names an image file, or the reverse.
  | 'resource-too-large' // The file is over 16 MiB.
  // The source, and what a change needs.
  | 'invalid-source' // Language refused the source. The failure's `source` says why.
  | 'invalid-input' // A whole change request failed Authoring's check, built here or sent back.
  | 'not-found' // The collection to change doesn't exist.
  | 'already-exists' // The collection to create already exists.
  | 'revision-required' // `replace` or `patch` without `--revision`.
  | 'revision-conflict' // `--revision` isn't the collection's current revision.
  | 'profile-structure' // `profile lint` found problems. The message lists them.
  // Talking to the service.
  | 'connection-uncertain' // No sure answer. Check the receipt before trying again.
  | 'invalid-response' // An answer broke its own contract, such as an apply with no receipt.
  // The program itself.
  | 'cli-unavailable' // The CLI couldn't finish: an unexpected throw, or a bad fresh request ID.
  | 'render-unavailable' // render:png couldn't start.
  | ThemeSourceCode; // `invalid-theme` or `duplicate-token`.

/**
 * A failure record the service package wrote, kept whole in `foreign`: either from the running
 * service, or from the package's reader of the agent's credential file.
 */
export type ForeignCode =
  | 'service-rejected' // The running service answered with a failure.
  | 'credential-unavailable'; // The service package couldn't read the agent's credential file.

/** Every code a CLI failure can carry. */
export type CliFailureCode = LocalCode | ForeignCode;

/**
 * Where a source declares the font or image a failure is about. Printed before the message, as
 * `file:line:column asset @alias`. Lines and columns count from 1.
 */
export interface SourceLocation extends Pick<SourcePosition, 'line' | 'column'> {
  /** The `.canvas` or `.theme` file that declares the font or image. */
  readonly file: FilePath;
  /** The name the declaration gives the font or image. */
  readonly alias: ResourceAlias;
}

/** A mistake the CLI found: its code, a message for people, and what to do next. */
export interface LocalFailure {
  readonly code: LocalCode;
  /** For people to read. Its wording may change, so code never branches on it. */
  readonly message: string;
  /** What to do next, such as "Correct the named input and retry." */
  readonly recovery: string;
  /** For a font or image mistake: where the source declares it. */
  readonly location?: SourceLocation;
  /** Why Language, Model or the service refused, kept whole (see `records/foreign.ts`). */
  readonly source?: FailureSource;
}

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

/** A mistake to hand to `failure`: a `LocalFailure` whose `recovery` may be left out. */
export type FailureInput = Omit<LocalFailure, 'recovery'> & { readonly recovery?: string };

/** The advice a mistake gets when it names no `recovery` of its own. */
const correctAndRetry = 'Correct the named input and retry.';

/** Wraps a value as a step that worked. */
export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Makes a failed step from a mistake the CLI found. If `recovery` is left out, it becomes
 * "Correct the named input and retry."
 */
export function failure(input: FailureInput): Result<never, LocalFailure> {
  const mistake = withRecovery(input);
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
 * recovery, then the rest.
 */
function withRecovery(input: FailureInput): LocalFailure {
  const { code, message, recovery = correctAndRetry, ...context } = input;
  return { code, message, recovery, ...context };
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
function withoutMissingFields(fields: UncheckedDetail): object {
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
function isNativeDetail(fields: object): fields is NativeDetail {
  return (
    isOptionalPath(Reflect.get(fields, 'path')) &&
    isOptionalText(Reflect.get(fields, 'systemCode')) &&
    isOptionalText(Reflect.get(fields, 'syscall'))
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
