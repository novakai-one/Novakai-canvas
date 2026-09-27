/*
 * The render abort boundary: owner failures stay structured until the CLI prints them, and no
 * partial render is reported as success. accepted() throws the typed RenderAbort; evidence()
 * converts whatever arrives at the entry point. Shared by core/render and the edge adapter.
 */
import { nativeFault, type RenderEvidence } from '../../contract/records/render-failure.js';
import type { Result } from '../../contract/errors.js';

/** The typed throw that ends one render; the entry point converts it to `render-failed`. */
export class RenderAbort extends Error {
  constructor(readonly evidence: RenderEvidence) {
    super('Headless render rejected');
  }
}

/** Unwrap an owner result; a failure ends the render with its structured evidence. */
export function accepted<T>(result: Result<T, RenderEvidence>): T {
  if (!result.ok) throw new RenderAbort(result.error);
  return result.value;
}

/** Preserve owner diagnostics; any other thrown error becomes `provider-failed` evidence. */
export function evidence(error: unknown): RenderEvidence {
  if (error instanceof RenderAbort) return error.evidence;
  return nativeFault(error);
}
