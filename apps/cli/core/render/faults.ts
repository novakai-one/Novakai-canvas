/*
 * The render fault boundary: owner failures stay structured until the CLI prints them, and no
 * partial render is reported as success. accepted() throws the typed RenderFault; evidence()
 * converts whatever arrives at the entry point. Shared by core/render and the edge adapter.
 */
import { nativeFault, type HeadlessSource } from '../../contract/records/headless.js';
import type { Result } from '../../contract/errors.js';

/** The typed fault that terminates one render; the entry point converts it to a failure. */
export class RenderFault extends Error {
  constructor(readonly evidence: HeadlessSource) {
    super('Headless render rejected');
  }
}

/** Unwrap an owner result; a failure terminates the render with its structured evidence. */
export function accepted<T>(result: Result<T, HeadlessSource>): T {
  if (!result.ok) throw new RenderFault(result.error);
  return result.value;
}

/** Preserve owner diagnostics; any other thrown error becomes `provider-failed` evidence. */
export function evidence(error: unknown): HeadlessSource {
  if (error instanceof RenderFault) return error.evidence;
  return nativeFault(error);
}
