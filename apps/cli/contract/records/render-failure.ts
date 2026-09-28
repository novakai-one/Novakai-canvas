/*
 * render:png's failure record: the evidence a failure can carry and the `render-failed` record
 * printed as JSON. Data only; the render's own faults are in render-fault.ts. The caller corrects
 * the named input or resource and runs render:png again.
 */
import type { CliFailure } from '../errors.js';
import type { FailureSource } from './foreign.js';
import type { RenderFault } from './render-fault.js';

/**
 * What a failed render carries: the CLI's own fault, a CLI failure (theme grammar, resource
 * reads), or Language, Model, Assets, Templates, service or Export evidence kept whole.
 */
export type RenderEvidence = RenderFault | CliFailure | FailureSource;

/** The failure render:png prints. Stored collections are never changed by a render. */
export interface RenderFailure {
  readonly code: 'render-failed';
  readonly message: string;
  readonly recovery: string;
  readonly source: RenderEvidence;
}
