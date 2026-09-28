/*
 * Why this file exists
 *
 * A change can use themes and uploaded files. For example, a DSL change that says `theme paper`
 * and shows a logo uses the `paper` theme and the logo's stored file. Before planning, the service
 * picks exactly which ones, from one snapshot. Every later step (holding the files, planning the
 * change, checking the result) must see that same pick.
 *
 * This file declares that pick: `ResourceSelection`. core/resources/selection builds it.
 *
 * Declarations only. Authoring decides whether the change is saved.
 */
import type { Json, ReadVersion, ResolvedResources } from '../capability-types.js';
import type { AuthoringDigest } from '../../brands.js';

/**
 * The themes and files one request uses, picked from one snapshot. The DSL planner picks again and
 * compares; a different pick means the snapshot moved, and the change is refused.
 */
export interface ResourceSelection {
  /** The picked themes and files, as Language and Templates use them. */
  readonly resources: ResolvedResources;
  /**
   * The same picked themes and files as plain JSON (`{ resources }`). Authoring keeps it with the
   * request, and the DSL planner compares it with its own pick.
   */
  readonly resourcesJson: Json;
  /** The digest of every stored file the pick uses. */
  readonly fileDigests: readonly AuthoringDigest[];
  /** The stored records the pick read, with their versions, so a later change to one is noticed. */
  readonly reads: readonly ReadVersion[];
}
