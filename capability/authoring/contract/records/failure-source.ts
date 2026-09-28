import { z } from 'zod';

/**
 * Records of a collaborator's own failure, kept unchanged under an Authoring failure's `source`.
 *
 * Codes here belong to the collaborator that raised them. Authoring keeps them as they are and never
 * interprets message text.
 */

/** A position in source text, exactly as the language compiler reported it. */
const position = z.strictObject({ offset: z.number(), line: z.number(), column: z.number() });

/** A range of source text. */
const span = z.strictObject({ start: position, end: position });

/** A failure about one record field. */
const recordDiagnostic = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
});

/** A failure in source-language text, with how to correct it and the domain failure behind it, when any. */
const languageDiagnostic = z.strictObject({
  code: z.string(),
  span,
  target: z.string(),
  expected: z.string(),
  message: z.string(),
  recovery: z.string(),
  source: recordDiagnostic.optional(),
});

/**
 * A new schema for one diagnostic inside a validation failure: about a record field or about a
 * source range. Each call builds a separate schema object (the first item and the rest of the
 * list each get their own).
 */
function fieldOrSourceDiagnostic(): z.ZodUnion<
  [typeof recordDiagnostic, typeof languageDiagnostic]
> {
  return z.union([recordDiagnostic, languageDiagnostic]);
}

/** A validation failure with one or more diagnostics. */
const validation = z.strictObject({
  code: z.literal('validation-failed'),
  diagnostics: z.tuple([fieldOrSourceDiagnostic()]).rest(fieldOrSourceDiagnostic()).readonly(),
});

/**
 * A collaborator's operational failure, with all its fields, its own source failure, and any
 * failure while cleaning up.
 */
export type OperationSource = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly recovery: string;
  readonly targets?: readonly string[] | undefined;
  readonly expected?: string | undefined;
  readonly traceId?: string | null | undefined;
  readonly source?: FailureSource | undefined;
  readonly cleanup?: OperationSource | undefined;
};

/** A collaborator failure kept as evidence under an Authoring failure. It is never a second result. */
export type FailureSource = Readonly<z.infer<typeof validation>> | OperationSource;

/** Checks an operational failure, including nested sources and cleanup failures. */
const operation: z.ZodType<OperationSource> = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  recovery: z.string(),
  targets: z.array(z.string()).readonly().optional(),
  expected: z.string().optional(),
  traceId: z.string().nullable().optional(),
  // Both are lazy because the schemas refer to themselves; each callback returns the schema to use.
  source: z.lazy(() => failureSource).optional(),
  cleanup: z.lazy(() => operation).optional(),
});

/** Checks a collaborator failure. Malformed evidence is rejected, never silently stripped of fields. */
export const failureSource: z.ZodType<FailureSource> = z.union([validation, operation]);
