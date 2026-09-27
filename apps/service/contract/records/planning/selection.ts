/*
 * The resources one request binds: what resource selection answers and what the planners,
 * candidate validation and leases compare. Declarations only; core/resources/selection builds it
 * and Authoring owns commit and retry.
 */
import type { Digest, Json, ReadVersion, ResolvedResources } from '../capabilities.js';

/** Immutable alias resolution is repeated against the same snapshot, then compared with Authoring's admitted pins. */
export interface ResourceSelection {
  readonly resources: ResolvedResources;
  readonly pins: Json;
  readonly covered: readonly Digest[];
  readonly reads: readonly ReadVersion[];
}
