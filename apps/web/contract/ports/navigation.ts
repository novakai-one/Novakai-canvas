/*
 * The browser location seam: which collection this tab's link names. Declarations only;
 * `adapters/edge/browser-navigation.ts` implements it. Reopening a link reads owners; it never
 * recreates or edits a diagram. The workspace session reports a failure and keeps its view.
 */
import type { Result } from '../errors.js';
import type { CollectionId } from '../brands.js';

/** Where a link points: the library, or one collection. */
export type LocationTarget =
  { readonly kind: 'library' } | { readonly kind: 'collection'; readonly collection: CollectionId };

/** Reads and writes the collection named in this tab's link. */
export interface WorkspaceNavigation {
  /** The link's target, its collection checked by Model. Fails with `invalid-location`. */
  current(): Result<LocationTarget>;
  /** Points the link at `target`. Fails with `navigation-unavailable`. */
  opened(target: LocationTarget): Result<void>;
}
