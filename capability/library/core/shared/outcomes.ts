/*
 * Building Library results: successes, failures with diagnostics, schema parsing, and the
 * `protect` boundary every entry point runs inside. Nothing here stores anything; the caller
 * corrects the input and calls again, and Authoring owns commit and recovery.
 */
import type { Diagnostic, LibraryResult } from '../../contract/errors.js';

/**
 * Builds a failure with one diagnostic and no partial value. Public entry points freeze it (see
 * {@link protect}).
 */
export function failure<T>(diagnostic: Diagnostic): LibraryResult<T> {
  const { code, path, message } = diagnostic;
  return {
    ok: false,
    error: { code: 'validation-failed', diagnostics: [{ code, path, message }] },
  };
}

/** Wraps a successful value. */
export function success<T>(value: T): LibraryResult<T> {
  return { ok: true, value };
}

/**
 * One diagnostic when a rule is violated, none otherwise. Throughout Library, `true` means the
 * rule is violated (the same convention as Model).
 */
export function diagnoseWhen(
  violated: boolean,
  diagnostic: Diagnostic,
): readonly Diagnostic[] {
  if (!violated) {
    return [];
  }
  const { code, path, message } = diagnostic;
  return [{ code, path, message }];
}

/**
 * Parses input with a schema and turns every schema issue into an `invalid-input` diagnostic, in the
 * schema's order: its path joined with `.` (the input root is `''`) and its message. The parse
 * never throws for bad data; a throw while reading the input is left to {@link protect}. Only
 * `safeParse` is used, so core does not import the schema library.
 *
 * @throws Whatever reading the input throws (for example a getter); {@link protect} catches it.
 */
export function parse<T>(
  parser: Parser<T>,
  input: unknown,
): LibraryResult<T> {
  const parsed = parser.safeParse(input);
  if (parsed.success) {
    return success(parsed.data);
  }
  const diagnostics = parsed.error.issues.map(shapeDiagnostic);
  return rejected(diagnostics);
}

/**
 * The boundary of every public entry point: runs `action` and deep-freezes its result. A throw
 * (for example from a getter on the input) becomes a frozen `invalid-input` failure at `$`, "Input could
 * not be read as supported data", so the entry point never throws.
 *
 * The result must be freshly built, acyclic data, never the caller's input. Proxies are not
 * supported: their traps may run before the input is rejected.
 */
export function protect<T>(action: () => LibraryResult<T>): LibraryResult<T> {
  try {
    return freeze(action());
  } catch {
    const unreadable = failure<T>({
      code: 'invalid-input',
      path: '$',
      message: 'Input could not be read as supported data',
    });
    return freeze(unreadable);
  }
}

/**
 * Builds a failure from a list of diagnostics. A list with none would be a provider fault, so it
 * becomes an `invalid-input` failure at `$`, "Validation provider rejected input without diagnostic
 * evidence".
 */
export function rejected<T>(diagnostics: readonly Diagnostic[]): LibraryResult<T> {
  const [first, ...remaining] = diagnostics;
  if (first === undefined) {
    return failure({
      code: 'invalid-input',
      path: '$',
      message: 'Validation provider rejected input without diagnostic evidence',
    });
  }
  return { ok: false, error: { code: 'validation-failed', diagnostics: [first, ...remaining] } };
}

/** One schema issue: the path to the bad value and the schema's message. */
interface ShapeIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The part of a schema {@link parse} uses. Declared here so core does not import zod. */
interface Parser<T> {
  /** Checks input: the parsed value or the rejecting issues. A throwing getter still throws. */
  safeParse(
    input: unknown,
  ):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: { readonly issues: readonly ShapeIssue[] } };
}

/** A schema issue as an `invalid-input` diagnostic: its path joined with `.`, and its message. */
function shapeDiagnostic(issue: ShapeIssue): Diagnostic {
  const segments = issue.path.map(String);
  return { code: 'invalid-input', path: segments.join('.'), message: issue.message };
}

/**
 * Deep-freezes a value: its enumerable own string-keyed values first (symbol keys are skipped),
 * then the value itself. Only for freshly built, acyclic results; never for the caller's input.
 */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const children = Object.values(value);
  children.forEach(freeze);
  return Object.freeze(value);
}
