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
  const { code, message, recovery = correctAndRetry, ...context } = input;
  return { ok: false, error: { code, message, recovery, ...context } };
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
  return { ok: false, error: { code, foreign } };
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
    message: nativeMessage(thrown),
    detail: nativeDetail(thrown),
  };
  return renderFaultFailure(fault);
}

/** The error's message as human context; no machine-readable field is invented. */
function nativeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The error's path, OS code and syscall, present ones only. When any present field is malformed
 * (not text, or an empty path) none is kept, so checked and unchecked evidence never mix.
 */
function nativeDetail(error: unknown): NativeDetail {
  const present = Object.fromEntries(
    Object.entries(nativeFields(error)).filter((field) => field[1] !== undefined),
  );
  if (!isNativeDetail(present)) return {};
  return present;
}

/** The three data fields of an object error under their detail names, unchecked; none otherwise. */
function nativeFields(error: unknown): { readonly [K in keyof NativeDetail]?: unknown } {
  if (typeof error !== 'object' || error === null) return {};
  return {
    path: Reflect.get(error, 'path'),
    systemCode: Reflect.get(error, 'code'),
    syscall: Reflect.get(error, 'syscall'),
  };
}

/** Whether every present field has its type: a non-empty path, a text code and a text syscall. */
function isNativeDetail(fields: object): fields is NativeDetail {
  return (
    isOptionalPath(Reflect.get(fields, 'path')) &&
    isOptionalText(Reflect.get(fields, 'systemCode')) &&
    isOptionalText(Reflect.get(fields, 'syscall'))
  );
}

/** Whether `value` is absent or a non-empty path. */
function isOptionalPath(value: unknown): value is FilePath | undefined {
  return value === undefined || filePath.safeParse(value).success;
}

/** Whether `value` is absent or text. */
function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}
