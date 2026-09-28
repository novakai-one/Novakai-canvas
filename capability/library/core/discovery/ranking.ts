/*
 * Sorting search hits. Text is compared by code unit, so the order is the same in every locale.
 * Pure; returns a new array and never changes its inputs. Authoring owns commit and recovery.
 */
import type { LibrarySnapshot } from '../../contract/records/snapshot.js';
import {
  HIT_KINDS,
  type QueryRequest,
  type SearchHit,
  type SortMode,
} from '../../contract/records/query.js';
import { compareText } from '../shared/text.js';

/**
 * Sorts hits for one request, returning a new array.
 *
 * - `order` (default): the collection entry's `order`, then collection ID, then kind (collection,
 *   section, object), then the hit's own ID.
 * - `title`: the lowercased label, then the `order` sort.
 * - `recent`: the most recently opened collection first (never-opened collections last), then the
 *   `order` sort.
 */
export function sortHits(
  hits: readonly SearchHit[],
  snapshot: LibrarySnapshot,
  request: QueryRequest,
): readonly SearchHit[] {
  const ranked = hits.map((hit) => rankMetadata(hit, snapshot));
  const ordered = ranked.toSorted(comparators[request.sort]);
  return ordered.map((item) => item.hit);
}

/** A hit with the keys it is sorted by. */
interface RankedHit {
  readonly hit: SearchHit;
  readonly order: number;
  readonly openedAt: number;
}

/** One comparator per sort; `title` and `recent` fall back to the full `order` sort on ties. */
const comparators: Readonly<Record<SortMode, (left: RankedHit, right: RankedHit) => number>> =
  Object.freeze({ order: compareOrder, title: compareTitle, recent: compareRecent });

/**
 * A hit with its sort keys: its collection entry's `order` and last visit time. Validation
 * guarantees every hit's collection has an entry; a collection never visited gets -1, below every
 * real epoch.
 */
function rankMetadata(
  hit: SearchHit,
  snapshot: LibrarySnapshot,
): RankedHit {
  const entry = snapshot.organisation.entries.find(
    (candidate) => candidate.collection === hit.collection,
  );
  const visit = snapshot.recent.find((candidate) => candidate.collection === hit.collection);
  return { hit, order: entry?.order ?? 0, openedAt: visit?.openedAt ?? -1 };
}

/** The `order` sort: entry order, collection ID, hit kind, then hit ID. */
function compareOrder(
  left: RankedHit,
  right: RankedHit,
): number {
  const membershipOrder = left.order - right.order;
  const collectionIdentity = compareText(left.hit.collection, right.hit.collection);
  const kind = HIT_KINDS.indexOf(left.hit.kind) - HIT_KINDS.indexOf(right.hit.kind);
  const identity = compareText(left.hit.id, right.hit.id);
  return firstDifference([membershipOrder, collectionIdentity, kind, identity]);
}

/** The `title` sort: the lowercased label, then the `order` sort. */
function compareTitle(
  left: RankedHit,
  right: RankedHit,
): number {
  const leftTitle = left.hit.label.toLowerCase();
  const rightTitle = right.hit.label.toLowerCase();
  return firstDifference([compareText(leftTitle, rightTitle), compareOrder(left, right)]);
}

/** The `recent` sort: the most recent visit first, then the `order` sort. */
function compareRecent(
  left: RankedHit,
  right: RankedHit,
): number {
  return firstDifference([right.openedAt - left.openedAt, compareOrder(left, right)]);
}

/** The first nonzero comparison, or 0 for an exact tie. */
function firstDifference(values: readonly number[]): number {
  const decisive = values.find((value) => value !== 0);
  return decisive ?? 0;
}
