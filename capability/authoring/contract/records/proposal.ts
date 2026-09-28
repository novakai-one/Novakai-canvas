import { z } from 'zod';
import { digest } from '../brands.js';
import type { Digest } from '../brands.js';
import { diagnosticSchema } from '../errors.js';
import type { Diagnostic } from '../errors.js';
import { writeSchema, versionSchema, jsonSchema } from './storage.js';
import type { Write, ReadVersion, Json, Snapshot } from './storage.js';

/** The most writes one proposal may contain. */
const MAXIMUM_PROPOSED_WRITES = 1000;

/** The most record versions one proposal or lease may list as reads. */
const MAXIMUM_LISTED_READS = 10000;

/**
 * Checks a planner's proposal. Planners return bounded data only, never callbacks that could
 * skip final validation. Resource pins come from admission, not from the planner.
 * `satisfies` makes the compiler check that a parsed proposal is a `Proposal`, so the two cannot drift.
 */
export const proposalSchema = z.strictObject({
  writes: z.array(writeSchema).max(MAXIMUM_PROPOSED_WRITES),
  reads: z.array(versionSchema).max(MAXIMUM_LISTED_READS),
  diff: jsonSchema,
  warnings: z.array(diagnosticSchema),
}) satisfies z.ZodType<Proposal>;

/** Checks a feasibility report. */
export const feasibilitySchema = z.strictObject({
  warnings: z.array(diagnosticSchema),
  diff: jsonSchema,
  preview: jsonSchema,
}) satisfies z.ZodType<FeasibilityReport>;

/** Checks the data of a resource lease. */
export const leaseDataSchema = z.strictObject({
  pins: jsonSchema,
  reads: z.array(versionSchema).max(MAXIMUM_LISTED_READS),
  covered: z.array(digest),
});

/** A planner's proposed change. */
export interface Proposal {
  /** The proposed writes. */
  readonly writes: readonly Write[];
  /** The record versions the planner read. */
  readonly reads: readonly ReadVersion[];
  /** A description of the change for the caller. */
  readonly diff: Json;
  /** Warnings that do not stop the change. */
  readonly warnings: readonly Diagnostic[];
}

/** The result of a feasibility check. */
export interface FeasibilityReport {
  /** Warnings that do not stop the change. */
  readonly warnings: readonly Diagnostic[];
  /** A description of the geometry change. */
  readonly diff: Json;
  /** A preview, as JSON the feasibility owner defines (for example a render document), or `null`. */
  readonly preview: Json;
}

/** A prepared change, returned by `prepare` for review before it is applied. */
export interface Preparation {
  /** The fingerprint of the submitted request. */
  readonly fingerprint: Digest;
  /**
   * The hash of `fingerprint`, `reads`, `changes`, `diff`, `warnings` and `pins`; not of
   * `candidateHash` itself or `preview`. `apply` can pass it to reject a changed candidate.
   */
  readonly candidateHash: Digest;
  /** Every record version the change depends on. */
  readonly reads: readonly ReadVersion[];
  /** The normalized writes that would be committed. */
  readonly changes: readonly Write[];
  /** The semantic and geometry descriptions of the change. */
  readonly diff: Json;
  /** Warnings from planning and the feasibility check. */
  readonly warnings: readonly Diagnostic[];
  /** The resource pins resolved for the request. */
  readonly pins: Json;
  /**
   * The preview, as JSON the feasibility owner defines, or `null`. A request with no changes gets
   * `null` even when a preview was asked for.
   */
  readonly preview: Json;
}

/**
 * A commit-ready candidate, private to Authoring. It keeps the snapshots before and after, so the
 * history written with the commit can be built from them.
 */
export interface PreparedCandidate {
  readonly preparation: Preparation;
  readonly before: Snapshot;
  readonly after: Snapshot;
}
