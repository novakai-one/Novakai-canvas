/*
 * The closed list of top-level codes an HTTP answer can carry, the wire failure and outcome built
 * on it, and every HTTP status the service answers with. Declarations, the code list and the
 * failure schema. A code is the service's own or one Authoring, Assets or Templates passes
 * through; nested `source` evidence keeps its owner's code. Clients branch on the code and status,
 * keep their draft and request ID, and reconcile the receipt before retrying.
 */
import { z } from 'zod';
import { errorCodes, type ErrorCode, type Result } from '../../errors.js';
import type { AssetErrorCode, AuthoringErrorCode, TemplatesErrorCode } from '../capabilities.js';
import { operationFields, type OperationSource } from './failure-source.js';

/** Every top-level wire code: the service's own and those Authoring, Assets, Templates pass on. */
export type WireErrorCode = ErrorCode | AuthoringErrorCode | AssetErrorCode | TemplatesErrorCode;

/** The 26 wire codes, each once. The build fails when a WireErrorCode is missing (`everyCode`). */
export const wireErrorCodes = everyCode([
  ...errorCodes,
  'unsupported-version',
  'unknown-reference',
  'invariant-violation',
  'constraint-conflict',
  'revision-conflict',
  'request-reused',
  'missing-asset',
  'permission-denied',
  'storage-unavailable',
  'corrupt-record',
  'unsupported-media',
  'unsafe-media',
  'corrupt-asset',
  'lease-expired',
  'missing-preset',
  'digest-mismatch',
  'version-exists',
  'duplicate-preset',
  'dependency-cycle',
  'provider-failed',
] as const);

/** A top-level wire failure: an operational failure whose code is a wire code. */
export interface WireFailure extends Omit<OperationSource, 'code'> {
  readonly code: WireErrorCode;
}

/** The wire failure as the response envelope checks it: a closed code over the operation fields. */
export const wireFailure: z.ZodType<WireFailure> = z.strictObject({
  code: z.enum(wireErrorCodes),
  ...operationFields,
});

/** A route's JSON outcome: any value, or a wire failure. */
export type WireOutcome = Result<unknown, WireFailure>;

/** Every HTTP status the service answers with. */
export type HttpStatus = 200 | 401 | 403 | 404 | 409 | 422 | 503;

/** The wire codes the list `T` leaves out. */
type Unlisted<T extends readonly WireErrorCode[]> = Exclude<WireErrorCode, T[number]>;

/** `unknown` when `T` lists every wire code; otherwise a required `missing` field naming the rest. */
type MissingCodes<T extends readonly WireErrorCode[]> = [Unlisted<T>] extends [never]
  ? unknown
  : { readonly missing: Unlisted<T> };

/**
 * Returns `codes` unchanged. Compiles only when `codes` lists every WireErrorCode; the compiler
 * error names the missing codes.
 */
function everyCode<const T extends readonly WireErrorCode[]>(codes: T & MissingCodes<T>): T {
  return codes;
}
