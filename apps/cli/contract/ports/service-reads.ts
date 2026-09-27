/*
 * The service's read-only calls, each answer already checked. Declaration only;
 * adapters/service-http/reads.ts implements it over the HTTP transport and owns the routes. Nothing
 * is written to the workspace, so the caller recovers by running the command again.
 */
import type { CollectionId, RequestId } from '../brands.js';
import type { Result } from '../errors.js';
import type { Receipt, Snapshot } from '../records/foreign.js';
import type { ReadScope } from '../records/command.js';
import type { Observed, Readout } from '../records/service-answers.js';

/**
 * One read of the local service. Every method fails with `connection-uncertain`,
 * `invalid-response` (the answer is not a service envelope, or does not match the checked shape)
 * or `service-rejected` (the service's own failure record, kept whole).
 */
export interface ServiceReads {
  /** The DSL vocabulary, as the service describes it; printed as JSON. */
  language(): Promise<Result<unknown>>;
  /** Every workspace record, checked by Authoring's snapshot schema, and the generation it came from. */
  workspace(): Promise<Result<Observed<Snapshot>>>;
  /** One collection's DSL source, narrowed to a section or object when `scope` names one. */
  source(
    collection: CollectionId,
    scope: ReadScope,
  ): Promise<Result<Readout>>;
  /** The service's inspection report of one collection; printed as JSON. */
  inspect(collection: CollectionId): Promise<Result<unknown>>;
  /** The committed receipt of `request`, or `null` when none exists, and the generation it came from. */
  receipt(request: RequestId): Promise<Result<Observed<Receipt | null>>>;
}
