/*
 * Why this file exists
 *
 * A failed HTTP answer carries one code the caller can branch on. For example, saving over a newer
 * version answers `revision-conflict` with status 409. The code is the service's own, or one that
 * Authoring, Assets or Templates passed through, so callers need the full list.
 *
 * This file holds that closed list (`httpErrorCodes`, 26 codes), the failure and answer built on
 * it, and every HTTP status the service uses. The build fails if a code is missing from the list.
 * Evidence under a failure keeps each capability's own codes (failure-source.ts).
 */
import { z } from 'zod';
import { errorCodes, type ErrorCode, type Result } from '../../errors.js';
import type {
  AssetErrorCode,
  AuthoringErrorCode,
  TemplatesErrorCode,
} from '../capability-types.js';
import { capabilityFailureFields, type CapabilityFailure } from './failure-source.js';

/**
 * One code a failed HTTP answer can carry: the service's own, or one Authoring, Assets or Templates
 * passed on.
 */
export type HttpErrorCode = ErrorCode | AuthoringErrorCode | AssetErrorCode | TemplatesErrorCode;

/** All 26 codes a failed HTTP answer can carry, each once. The build fails if one is missing. */
export const httpErrorCodes = everyCode([
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
export interface HttpFailure extends Omit<CapabilityFailure, 'code'> {
  readonly code: HttpErrorCode;
}

/** Checks the failure in an HTTP answer: a code from the list, and the other failure fields. */
export const httpFailure: z.ZodType<HttpFailure> = z.strictObject({
  code: z.enum(httpErrorCodes),
  ...capabilityFailureFields,
});

/** A route's JSON answer: any value, or a failure with a code from the list. */
export type HttpOutcome = Result<unknown, HttpFailure>;

/** Every HTTP status the service answers with. */
export type HttpStatus = 200 | 401 | 403 | 404 | 409 | 422 | 503;

/** The HTTP failure codes the list `T` leaves out. */
type Unlisted<T extends readonly HttpErrorCode[]> = Exclude<HttpErrorCode, T[number]>;

/** `unknown` when `T` lists every code; otherwise a required `missing` field naming the rest. */
type MissingCodes<T extends readonly HttpErrorCode[]> = [Unlisted<T>] extends [never]
  ? unknown
  : { readonly missing: Unlisted<T> };

/**
 * Returns `codes` unchanged, and compiles only when they list every `HttpErrorCode` (the compiler
 * error names any code left out).
 */
function everyCode<const T extends readonly HttpErrorCode[]>(codes: T & MissingCodes<T>): T {
  return codes;
}
