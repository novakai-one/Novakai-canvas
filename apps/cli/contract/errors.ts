/*
 * The CLI's failure vocabulary: the foreign failure, the Result every layer returns and the
 * builders of each failure shape, plus the builders of render:png's own faults (`faulted`, and
 * `nativeFault` for a native throw). The local failure codes and shapes are declared in
 * records/local-failure.ts and re-exported here, so every layer imports failures from one place.
 * Pure. Nothing throws across a boundary; `cli/canvas.ts` prints the failure and sets the exit
 * code. Consumers branch on the code, never on the message. The fault builders are here, not in
 * records/ (data only) or a file of their own, because render core and the render adapters both
 * call them and core may import only records/, ports/, brands, schemas and errors.
 */
import { filePath, type FilePath, type RequestId } from './brands.js';
import type { OperationSource } from './records/foreign.js';
import type {
  EvidencedFailure,
  LocalCode,
  LocalFailure,
  LocatedFailure,
  PlainFailure,
  SourceLocation,
  UnreadResource,
} from './records/local-failure.js';
import type { NativeDetail, ProviderFault, RenderFault } from './records/render-fault.js';

export type {
  EvidenceCode,
  EvidencedFailure,
  LocalCode,
  LocalFailure,
  LocatedCode,
  LocatedFailure,
  PlainCode,
  PlainFailure,
  SourceLocation,
  UnreadResource,
} from './records/local-failure.js';

/**
 * A failure another owner wrote, kept whole in `foreign`.
 * - `service-rejected`: the service answered with a failure.
 * - `credential-unavailable`: the service's credential reader could not read the agent credential.
 */
export type ForeignCode = 'service-rejected' | 'credential-unavailable';

/** Every code a CLI failure can carry. */
export type CliErrorCode = LocalCode | ForeignCode;

/** A service failure record, printed exactly as the service wrote it. */
export interface ForeignFailure {
  readonly code: ForeignCode;
  readonly foreign: OperationSource;
}

/** Any CLI failure. */
export type CliFailure = LocalFailure | ForeignFailure;

/** The CLI's own success-or-failure envelope. A failure never carries a partial value. */
export type Result<T, E = CliFailure> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** What `failure` needs: a plain failure whose `recovery` may be omitted. */
export type FailureInput = Omit<PlainFailure, 'recovery'> & { readonly recovery?: string };

const correctAndRetry = 'Correct the named input and retry.';

/** Wraps a successful value. */
export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Builds a plain failure. `recovery` defaults to 'Correct the named input and retry.' */
export function failure(input: FailureInput): Result<never, PlainFailure> {
  const { code, message, recovery = correctAndRetry } = input;
  return { ok: false, error: { code, message, recovery } };
}

/**
 * Builds the failure of an unread font or image, naming its declaration at `location`. The
 * recovery is the default one.
 */
export function located(
  unread: UnreadResource,
  location: SourceLocation,
): Result<never, LocatedFailure> {
  const { code, message } = unread;
  return { ok: false, error: { code, message, recovery: correctAndRetry, location } };
}

/** Builds a failure that keeps another owner's evidence, `source`, whole. */
export function evidenced(input: EvidencedFailure): Result<never, EvidencedFailure> {
  const { code, message, recovery, source } = input;
  return { ok: false, error: { code, message, recovery, source } };
}

/**
 * `source-unavailable` naming `path`: the FILE cannot be read as UTF-8 text. Core's FILE check (an
 * empty path) and the local-files read report the same text.
 */
export function unreadableSource(path: string): FailureInput {
  return { code: 'source-unavailable', message: `Cannot read UTF-8 source: ${path}` };
}

/**
 * `output-unavailable` naming `path`: the --out file cannot be written. Core's --out check (an
 * empty path) and the local-files write report the same text.
 */
export function unwritableOutput(path: string): FailureInput {
  return { code: 'output-unavailable', message: `Cannot write output: ${path}` };
}

/**
 * `invalid-input`: an Authoring request failed Authoring's schema. Core's DSL request builder and
 * the resources adapter's check of the frozen request report the same text.
 */
export const malformedRequest: FailureInput = Object.freeze({
  code: 'invalid-input',
  message: 'Request identity or generated preconditions are invalid',
});

/**
 * `invalid-response` for an apply answer that does not confirm a commit. The write may have
 * happened, so the recovery checks `request`'s receipt before any retry.
 */
export function unconfirmedApply(
  request: RequestId,
  message: string,
): FailureInput {
  return {
    code: 'invalid-response',
    message,
    recovery: `Check canvas receipt ${request} before retrying.`,
  };
}

/** Wraps another owner's failure record without changing it. */
export function rejected(
  code: ForeignCode,
  foreign: OperationSource,
): Result<never, ForeignFailure> {
  return { ok: false, error: { code, foreign } };
}

/** Render fault `fault` as a failed Result, typed as its own fault; nothing else is returned. */
export function faulted<F extends RenderFault>(fault: F): Result<never, F> {
  return { ok: false, error: fault };
}

/**
 * A thrown native error as `provider-failed` evidence: its message, path, OS code and syscall.
 * Only data fields are read, never methods; absent evidence stays absent. Cannot fail.
 */
export function nativeFault(error: unknown): ProviderFault {
  return {
    code: 'provider-failed',
    message: nativeMessage(error),
    detail: nativeDetail(error),
  };
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
