/*
 * Why this file exists
 *
 * A failed HTTP answer carries one code the caller can branch on. For example, saving over a newer
 * version answers `revision-conflict` with status 409. The code is the service's own, or one that
 * Authoring, Assets or Templates passed through, so callers need the full list.
 *
 * This file holds that closed list (`wireErrorCodes`, 26 codes), the failure and answer built on
 * it, and every HTTP status the service uses. The build fails if a code is missing from the list.
 * Evidence under a failure keeps each capability's own codes (failure-source.ts).
 */
import { z } from 'zod';
import { errorCodes, type ErrorCode, type Result } from '../../errors.js';
import type { AssetErrorCode, AuthoringErrorCode, TemplatesErrorCode } from '../capabilities.js';
import { operationFields, type OperationSource } from './failure-source.js';

/**
 * One code a failed HTTP answer can carry: the service's own, or one Authoring, Assets or Templates
 * passed on.
 */
export type WireErrorCode = ErrorCode | AuthoringErrorCode | AssetErrorCode | TemplatesErrorCode;

/** All 26 codes a failed HTTP answer can carry, each once. The build fails if one is missing. */
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

/** The failure in an HTTP answer: a code from the list, with where, what and what to do next. */
export interface WireFailure extends Omit<OperationSource, 'code'> {
  readonly code: WireErrorCode;
}

/** Checks the failure in an HTTP answer: a code from the list, and the other failure fields. */
export const wireFailure: z.ZodType<WireFailure> = z.strictObject({
  code: z.enum(wireErrorCodes),
  ...operationFields,
});

/** A route's JSON answer: any value, or a failure with a code from the list. */
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
