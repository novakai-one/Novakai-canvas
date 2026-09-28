/*
 * Why this file exists
 *
 * A change can use themes and uploaded files. For example, a DSL change that says `theme paper`
 * and shows a logo uses the `paper` theme and the logo's stored file. Before planning, the service
 * picks exactly which ones, from one snapshot. Later steps (the planners, the candidate check and
 * the file holds) must all see that same pick.
 *
 * This file declares that pick: `ResourceSelection`. core/resources/selection builds it.
 *
 * Declarations only. Authoring decides whether the change is saved.
 */
import type { Json, ReadVersion, ResolvedResources } from '../capabilities.js';
import type { AuthoringDigest } from '../../brands.js';

/**
 * The themes and files one request uses, picked from one snapshot. The pick is made again on the
 * same snapshot and compared with what Authoring accepted, so both must match.
 */
export interface ResourceSelection {
  /** The picked themes and files, as Language and Templates use them. */
  readonly resources: ResolvedResources;
  /**
   * The same picked themes and files as plain JSON (`{ resources }`). Authoring keeps it with the
   * request, and the DSL planner compares it with its own pick.
   */
  readonly pins: Json;
  /** The digest of every stored file the pick uses. */
  readonly covered: readonly AuthoringDigest[];
  /** The stored records the pick read, with their versions, so a later change to one is noticed. */
  readonly reads: readonly ReadVersion[];
}
