/*
 * The web's failure vocabulary. A failure is either the web's own (`origin: 'web'`, a closed
 * `WebErrorCode`) or another owner's, kept with that owner's closed code and its own record
 * (built by `foreign-failures.ts`). Consumers branch on `origin` and `code`, never on the message.
 * Declarations and pure constructors that never throw; whoever shows a failure owns recovery.
 */
import type { ErrorCode as AuthoringErrorCode } from '@novakai/canvas-authoring';
import type { ErrorCode as ServiceErrorCode, OperationSource } from '@novakai/canvas-service';
import type { Diagnostic as CanvasDiagnostic } from '@novakai/canvas-canvas';
import type { ValidationError as LibraryFailure } from '@novakai/canvas-library';
import type { Diagnostic as LayoutDiagnostic } from '@novakai/canvas-layout';
import type { ValidationError as LanguageFailure } from '@novakai/canvas-language';
import type { Diagnostic as PresentationDiagnostic } from '@novakai/canvas-presentation';
import type { TokenError } from '@novakai/canvas-design-system';
import type { WebErrorCode } from './records/error-codes.js';

/** What a person reads: what went wrong and what to do next. */
interface Text {
  readonly message: string;
  readonly recovery: string;
}

/**
 * Another owner's failure, keyed by who sent it, with that owner's closed code and its whole
 * record as `source`. Library and Language answer a list of problems; `code` is the first one's.
 * A service answer whose code is in no known union is `unrecognised-failure`.
 */
export type ForeignDiagnostic = Text &
  (
    | {
        readonly origin: 'authoring';
        readonly code: AuthoringErrorCode;
        readonly source: OperationSource;
      }
    | {
        readonly origin: 'service';
        readonly code: ServiceErrorCode;
        readonly source: OperationSource;
      }
    | Owned<'canvas', CanvasDiagnostic>
    | Owned<'layout', LayoutDiagnostic>
    | Owned<'presentation', PresentationDiagnostic>
    | Owned<'design-system', TokenError>
    | {
        readonly origin: 'library';
        readonly code: ProblemCode<LibraryFailure>;
        readonly source: LibraryFailure;
      }
    | {
        readonly origin: 'language';
        readonly code: ProblemCode<LanguageFailure>;
        readonly source: LanguageFailure;
      }
    | {
        readonly origin: 'unrecognised';
        readonly code: 'unrecognised-failure';
        readonly source: OperationSource;
      }
  );

/** A failure the web detects itself. `cause` keeps the foreign failure behind it; omitted when none. */
export type WebDiagnostic = Text & {
  readonly origin: 'web';
  readonly code: WebErrorCode;
  readonly cause?: ForeignDiagnostic;
};

/** Any failure the web shows. */
export type Diagnostic = WebDiagnostic | ForeignDiagnostic;

/** An Authoring failure, as the service answered it. */
export type AuthoringDiagnostic = Extract<ForeignDiagnostic, { readonly origin: 'authoring' }>;

/** Locally owned success/failure envelope; E retains the owning capability's structured failure. */
export type Result<T, E = Diagnostic> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** An owner whose failure record carries its own code, kept whole as `source`. */
type Owned<O extends string, S extends { readonly code: string }> = {
  readonly origin: O;
  readonly code: S['code'];
  readonly source: S;
};

/** The code of the first problem in an owner's list of problems. */
type ProblemCode<
  F extends { readonly diagnostics: readonly [{ readonly code: string }, ...unknown[]] },
> = F['diagnostics'][0]['code'];

/** The recovery every `failure` shares. */
const SHARED_RECOVERY =
  'Keep your draft. Correct the problem or reconnect, then reconcile any pending request.';

/**
 * A failed result with the web's shared recovery text. `cause` is kept when given (the key is
 * omitted otherwise).
 */
export function failure<T>(
  code: WebErrorCode,
  message: string,
  cause?: ForeignDiagnostic,
): Extract<Result<T>, { readonly ok: false }> {
  return { ok: false, error: diagnostic(code, message, SHARED_RECOVERY, cause) };
}

/**
 * One web failure with its own recovery text, for failures the shared text does not fit. The
 * result keeps the exact code type. `cause` is kept when given (the key is omitted otherwise).
 */
export function diagnostic<C extends WebErrorCode>(
  code: C,
  message: string,
  recovery: string,
  cause?: ForeignDiagnostic,
): WebDiagnostic & { readonly code: C } {
  const own = { origin: 'web', code, message, recovery } as const;
  if (cause === undefined) return own;
  return { ...own, cause };
}
