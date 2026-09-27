/*
 * Other owners' failures as web diagnostics. Each keeps its owner's closed code and its whole
 * record, so consumers branch on `origin` and `code` and the technical details show everything the
 * owner said. Pure; never throws. Whoever shows the failure owns recovery.
 */
import type { ErrorCode as AuthoringErrorCode } from '@novakai/canvas-authoring';
import type { ErrorCode as ServiceErrorCode, OperationSource } from '@novakai/canvas-service';
import type { Diagnostic as CanvasDiagnostic } from '@novakai/canvas-canvas';
import type { ValidationError as LibraryFailure } from '@novakai/canvas-library';
import type { Diagnostic as LayoutDiagnostic } from '@novakai/canvas-layout';
import type { ValidationError as LanguageFailure } from '@novakai/canvas-language';
import type { Diagnostic as PresentationDiagnostic } from '@novakai/canvas-presentation';
import type { TokenError } from '@novakai/canvas-design-system';
import type { Diagnostic, ForeignDiagnostic, Result } from './errors.js';

/** The owners that answer over the service wire. */
export type WireOwner = 'authoring' | 'service';

/** An owner's own success-or-failure envelope. */
export type OwnerResult<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * A service wire failure as a diagnostic. `owner` answers this endpoint, decided once by the
 * caller: `authoring` for apply and receipt, `service` for the rest. The code is checked against
 * that owner's closed union first, then the other owner's, so a code both know (`invalid-input`,
 * `cancelled`) belongs to `owner`. A code in neither is `unrecognised-failure`, with the raw
 * failure kept in `source`.
 */
export function foreignFailure(
  owner: WireOwner,
  source: OperationSource,
): ForeignDiagnostic {
  const [first, second] = answerOrder[owner];
  return wireFailure(first, source) ?? wireFailure(second, source) ?? unrecognised(source);
}

/** A service wire outcome as a web result; a failure goes through {@link foreignFailure}. */
export function wireOutcome<T>(
  owner: WireOwner,
  outcome: OwnerResult<T, OperationSource>,
): Result<T> {
  return ownerResult(outcome, (source) => foreignFailure(owner, source));
}

/**
 * An owner's result as a web result. `read` turns its failure into a diagnostic: the owner's own,
 * or a web failure that keeps it as `cause`.
 */
export function ownerResult<T, E>(
  result: OwnerResult<T, E>,
  read: (error: E) => Diagnostic,
): Result<T> {
  if (result.ok) return result;
  return { ok: false, error: read(result.error) };
}

/** A Canvas failure, kept as Canvas reported it. */
export function canvasFailure(source: CanvasDiagnostic): ForeignDiagnostic {
  return { origin: 'canvas', code: source.code, source, ...textOf(source) };
}

/** A Layout failure, kept as Layout reported it. */
export function layoutFailure(source: LayoutDiagnostic): ForeignDiagnostic {
  return { origin: 'layout', code: source.code, source, ...textOf(source) };
}

/** A Presentation failure, kept as Presentation reported it. */
export function presentationFailure(source: PresentationDiagnostic): ForeignDiagnostic {
  return { origin: 'presentation', code: source.code, source, ...textOf(source) };
}

/** A Design System failure, kept as Design System reported it. */
export function designSystemFailure(source: TokenError): ForeignDiagnostic {
  return { origin: 'design-system', code: source.code, source, ...textOf(source) };
}

/**
 * A Library rejection, read by its first problem; every problem stays in `source`. Library gives
 * no recovery text, so the web's is used.
 */
export function libraryFailure(source: LibraryFailure): ForeignDiagnostic {
  const [first] = source.diagnostics;
  return {
    origin: 'library',
    code: first.code,
    source,
    message: first.message,
    recovery: 'Correct the named folder or collection, then try again.',
  };
}

/** A Language rejection, read by its first problem; every problem stays in `source`. */
export function languageFailure(source: LanguageFailure): ForeignDiagnostic {
  const [first] = source.diagnostics;
  return { origin: 'language', code: first.code, source, ...textOf(first) };
}

/** Which owner's union each endpoint owner checks first. */
const answerOrder: Readonly<Record<WireOwner, readonly [WireOwner, WireOwner]>> = Object.freeze({
  authoring: ['authoring', 'service'],
  service: ['service', 'authoring'],
});

/** Every Authoring code; the type makes the list complete. */
const authoringCodes: Readonly<Record<AuthoringErrorCode, true>> = Object.freeze({
  'invalid-input': true,
  'unsupported-version': true,
  'unknown-reference': true,
  'invariant-violation': true,
  'constraint-conflict': true,
  'revision-conflict': true,
  'request-reused': true,
  'missing-asset': true,
  'permission-denied': true,
  'storage-unavailable': true,
  'corrupt-record': true,
  cancelled: true,
});

/** Every Service code; the type makes the list complete. */
const serviceCodes: Readonly<Record<ServiceErrorCode, true>> = Object.freeze({
  'invalid-input': true,
  unauthorized: true,
  'not-found': true,
  unavailable: true,
  conflict: true,
  cancelled: true,
});

/** `source` as `owner`'s failure; undefined when its code is not one of `owner`'s. */
function wireFailure(
  owner: WireOwner,
  source: OperationSource,
): ForeignDiagnostic | undefined {
  switch (owner) {
    case 'authoring':
      return authoringFailure(source);
    case 'service':
      return serviceFailure(source);
    default:
      return unsupported(owner);
  }
}

/** `source` as an Authoring failure; undefined when its code is not Authoring's. */
function authoringFailure(source: OperationSource): ForeignDiagnostic | undefined {
  const code = source.code;
  if (!isAuthoringCode(code)) return undefined;
  return { origin: 'authoring', code, source, ...textOf(source) };
}

/** `source` as a Service failure; undefined when its code is not the Service's. */
function serviceFailure(source: OperationSource): ForeignDiagnostic | undefined {
  const code = source.code;
  if (!isServiceCode(code)) return undefined;
  return { origin: 'service', code, source, ...textOf(source) };
}

/** A wire failure whose code no known owner uses. */
function unrecognised(source: OperationSource): ForeignDiagnostic {
  return { origin: 'unrecognised', code: 'unrecognised-failure', source, ...textOf(source) };
}

/** Whether `code` is one of Authoring's codes. */
function isAuthoringCode(code: string): code is AuthoringErrorCode {
  return Object.hasOwn(authoringCodes, code);
}

/** Whether `code` is one of the Service's codes. */
function isServiceCode(code: string): code is ServiceErrorCode {
  return Object.hasOwn(serviceCodes, code);
}

/** The message and recovery of an owner's failure. */
function textOf(source: { readonly message: string; readonly recovery: string }): {
  readonly message: string;
  readonly recovery: string;
} {
  return { message: source.message, recovery: source.recovery };
}

/** No owner of another kind exists; the `never` type proves every owner above is handled. */
function unsupported(owner: never): undefined {
  void owner;
  return undefined;
}
