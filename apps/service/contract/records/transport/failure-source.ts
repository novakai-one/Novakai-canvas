/*
 * Why this file exists
 *
 * When a capability finds a mistake, the service answers with its own code but keeps the
 * capability's failure underneath as evidence (`source`). For example, a DSL change with a typo
 * answers `invalid-input`, and its `source` holds Language's diagnostic with the typo's line and
 * column. Evidence can nest: a failure may carry the failure that caused it.
 *
 * This file holds the check for that evidence (`failureSource`) and its type. The codes inside are
 * each capability's own; only the top-level code comes from a closed list (wire-codes.ts). Callers
 * keep the evidence and branch on the top-level code, never on a message.
 */
import { z } from 'zod';
/** A place in DSL text: its character offset, line and column, exactly as Language gave them. */
const position = z.strictObject({ offset: z.number(), line: z.number(), column: z.number() });
/** A stretch of DSL text, from `start` to `end`. */
const span = z.strictObject({ start: position, end: position });
/** One mistake in a stored record, at its `path`. The code is the capability's own. */
const recordDiagnostic = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
});
/**
 * One mistake in DSL text: where it is, what was found, what was expected and how to fix it, and
 * the record mistake behind it when there is one.
 */
const languageDiagnostic = z.strictObject({
  code: z.string(),
  span,
  target: z.string(),
  expected: z.string(),
  message: z.string(),
  recovery: z.string(),
  source: recordDiagnostic.optional(),
});
/** A failed check: one or more record or DSL mistakes, each kept as it was reported. */
const validation = z.strictObject({
  code: z.literal('validation-failed'),
  diagnostics: z
    .tuple([z.union([recordDiagnostic, languageDiagnostic])])
    .rest(z.union([recordDiagnostic, languageDiagnostic]))
    .readonly(),
});
/**
 * One capability's failure, with everything it reported. `source` is the failure that caused it,
 * and `cleanup` a second failure that happened while cleaning up after it.
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
/**
 * The evidence kept under a service failure: a failed check, or a capability's failure. It never
 * replaces the service's own code.
 */
export type FailureSource = z.infer<typeof validation> | OperationSource;
/**
 * Every field of a capability's failure except its code. `operationSource` adds the capability's
 * own code; the top-level failure (wire-codes.ts) adds a code from the closed list.
 */
export const operationFields = {
  path: z.string(),
  message: z.string(),
  recovery: z.string(),
  targets: z.array(z.string()).readonly().optional(),
  expected: z.string().optional(),
  traceId: z.string().nullable().optional(),
  source: z.lazy(() => failureSource).optional(),
  cleanup: z.lazy(() => operationSource).optional(),
};
/** Checks one capability's failure as it arrives over HTTP. No field is dropped. */
export const operationSource: z.ZodType<OperationSource> = z.strictObject({
  code: z.string(),
  ...operationFields,
});
/** Checks the evidence under a failure. Malformed evidence is refused, never quietly trimmed. */
export const failureSource: z.ZodType<FailureSource> = z.union([validation, operationSource]);
