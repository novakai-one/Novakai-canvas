/*
 * The browser location: reads the `collection` query parameter of this tab's link with Model's
 * collection ID schema, and rewrites the link after a collection opens or the library shows.
 * Reads `location` and calls `history.replaceState`; nothing else is written. Every method answers
 * a `Result` and never throws; the workspace session reports a failure and keeps its view.
 */
import { collectionId } from '@novakai/canvas-model';
import type { LocationTarget, WorkspaceNavigation } from '../../contract/ports/navigation.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** The library: a link with no collection. */
const LIBRARY: LocationTarget = Object.freeze({ kind: 'library' });

/**
 * The navigation over this tab's `location` and `history`. The link survives a browser refresh and
 * a service restart. A failure leaves the readable canvas and the stored diagram untouched.
 */
export function createWorkspaceNavigation(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'>,
): WorkspaceNavigation {
  return {
    current: () => current(location.href),
    opened: (target) => opened(location.href, history, target),
  };
}

/**
 * The link's target. The collection is admitted by Model; an arbitrary value is never read as a
 * diagram path. Fails with `invalid-location` when it is not a collection ID.
 */
function current(href: string): Result<LocationTarget> {
  const value = new URL(href).searchParams.get('collection');
  if (value === null) return { ok: true, value: LIBRARY };
  const checked = collectionId.safeParse(value);
  if (!checked.success)
    return failure('invalid-location', 'The collection link contains an invalid identity');
  return { ok: true, value: { kind: 'collection', collection: checked.data } };
}

/**
 * Points the link at `target` without adding a history entry. Only an opened collection or the
 * library moves it; browser history owns no records. Fails with `navigation-unavailable` when the
 * link cannot be rewritten.
 */
function opened(
  href: string,
  history: Pick<History, 'replaceState'>,
  target: LocationTarget,
): Result<void> {
  try {
    history.replaceState(null, '', pointedAt(new URL(href), target));
    return { ok: true, value: undefined };
  } catch {
    return failure(
      'navigation-unavailable',
      'The collection opened, but its browser link could not be updated',
    );
  }
}

/** `url` pointing at `target`: the library drops the parameter, a collection sets it. */
function pointedAt(
  url: URL,
  target: LocationTarget,
): URL {
  if (target.kind === 'library') {
    url.searchParams.delete('collection');
    return url;
  }
  url.searchParams.set('collection', target.collection);
  return url;
}
