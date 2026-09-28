/*
 * The evidence a failure carries under its code: a record or source-language validation, or an
 * owner's operational failure, nested to any depth. Schemas and their types. The codes inside stay
 * each owner's open text; the top-level wire code is closed (wire-codes.ts). Consumers keep the
 * evidence and branch on the top-level code, never on a message.
 */
import { z } from 'zod';
/** Source coordinates retain the compiler's exact character and line addresses. */
const position = z.strictObject({ offset: z.number(), line: z.number(), column: z.number() });
const span = z.strictObject({ start: position, end: position });
/** Foreign codes remain owner-defined. Consumers retain them; they do not reinterpret message text. */
const recordDiagnostic = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
});
/** A source-language diagnostic retains correction guidance and the original domain issue when present. */
const languageDiagnostic = z.strictObject({
  code: z.string(),
  span,
  target: z.string(),
  expected: z.string(),
  message: z.string(),
  recovery: z.string(),
  source: recordDiagnostic.optional(),
});
/** Consumer-owned validation evidence supports both record addresses and source spans without flattening either. */
const validation = z.strictObject({
  code: z.literal('validation-failed'),
  diagnostics: z
    .tuple([z.union([recordDiagnostic, languageDiagnostic])])
    .rest(z.union([recordDiagnostic, languageDiagnostic]))
    .readonly(),
});
/** A wrapped operational failure retains all supported owner metadata, including nested validation evidence. */
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
/** Source data is evidence under the primary error, never a second top-level Result channel. */
export type FailureSource = z.infer<typeof validation> | OperationSource;
/**
 * Every field of an operational failure except its code. `operationSource` pairs them with an
 * owner's open code; the top-level wire failure (wire-codes.ts) pairs them with its closed code.
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
/** Complete operational envelope used at the HTTP boundary; metadata is never silently stripped. */
export const operationSource: z.ZodType<OperationSource> = z.strictObject({
  code: z.string(),
  ...operationFields,
});
/** Runtime decoding rejects malformed evidence rather than silently stripping codes, paths or spans. */
export const failureSource: z.ZodType<FailureSource> = z.union([validation, operationSource]);
