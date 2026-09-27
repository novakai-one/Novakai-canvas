/*
 * Which answers to an apply are proven refusals. A refusal changed nothing, so its request can be
 * dismissed; any other failure may have committed and needs its receipt checked. Pure; the
 * request journal that acts on the class owns recovery.
 */
import type { AuthoringDiagnostic, Diagnostic } from '../../../contract/errors.js';

/**
 * Whether an apply answer is a proven refusal: an Authoring code that refuses before commit. Any
 * other answer (Authoring storage or cancellation, a service or unrecognised failure) needs
 * receipt reconciliation.
 */
export function refused(problem: Diagnostic): boolean {
  if (problem.origin !== 'authoring') return false;
  return answerClass[problem.code] === 'refused';
}

/** What an apply answer proves: a refusal before commit, or nothing (the receipt decides). */
type AnswerClass = 'refused' | 'unknown';

/** The class of each Authoring code; the type makes the table complete. */
const answerClass: Readonly<Record<AuthoringDiagnostic['code'], AnswerClass>> = Object.freeze({
  'invalid-input': 'refused',
  'unsupported-version': 'refused',
  'unknown-reference': 'refused',
  'invariant-violation': 'refused',
  'constraint-conflict': 'refused',
  'revision-conflict': 'refused',
  'missing-asset': 'refused',
  'permission-denied': 'refused',
  'request-reused': 'unknown',
  'storage-unavailable': 'unknown',
  'corrupt-record': 'unknown',
  cancelled: 'unknown',
});
