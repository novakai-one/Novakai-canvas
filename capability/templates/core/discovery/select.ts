import type { Catalog, Selection, Preset, Query } from '../../contract/records/preset.js';
import type { Summary } from '../../contract/types.js';
import type { Version } from '../../contract/brands.js';
import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../validation/outcomes.js';
import { pinOf } from '../validation/catalog.js';

/**
 * Compares two versions part by part as numbers, so `2.10.0` is later than `2.9.0`. Both must
 * already match the version format.
 *
 * @param left - The first version.
 * @param right - The second version.
 * @returns Negative when `left` is earlier, positive when later, 0 when equal.
 * @throws Never.
 */
export function compareVersions(
  left: Version,
  right: Version,
): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  return (
    a.map((value, index) => value - (b[index] ?? 0)).find((difference) => difference !== 0) ?? 0
  );
}

/**
 * Selects one preset by kind and id: the given version, or the latest version when none is given.
 * When a digest is given (only allowed with a version), the preset's digest must match.
 *
 * @param records - The validated catalog.
 * @param request - The parsed selection.
 * @returns The whole preset; `missing-preset` (path: the id) when nothing matches; or
 * `digest-mismatch` (path: the id) when the digest differs.
 * @throws Never.
 */
export function select(
  records: Catalog,
  request: Selection,
): Result<Preset> {
  const choices = records.filter((value) => value.kind === request.kind && value.id === request.id);
  const releases = choices.filter(
    (value) => request.version === undefined || value.version === request.version,
  );
  const selected = releases.toSorted((a, b) => compareVersions(b.version, a.version))[0];
  if (!selected) {
    return fail('missing-preset', request.id, 'No matching preset version');
  }
  return verifySelection(selected, request);
}

/**
 * Lists presets matching a query as summaries. Nothing is stored; the caller owns any UI state.
 *
 * - `kind`, when given, must match.
 * - `search` (lowercased) must appear in the id, title, description or recipe family, joined by
 *   spaces and lowercased. Recipe source and theme tokens are not searched.
 * - Ordered by `kind/id` (`localeCompare`, locale `en`), then by version, earliest first.
 *
 * @param records - The validated catalog.
 * @param query - The parsed query (defaults applied).
 * @returns The summaries: pin, title, description, and the recipe family (`null` for themes).
 * @throws Never.
 */
export function list(
  records: Catalog,
  query: Query,
): readonly Summary[] {
  return records
    .filter((value) => matches(value, query))
    .toSorted(compare)
    .map(summarize);
}

/** A given digest is a hard requirement, not a hint: a different digest is `digest-mismatch`. */
function verifySelection(
  value: Preset,
  request: Selection,
): Result<Preset> {
  if (request.digest && request.digest !== value.digest) {
    return fail('digest-mismatch', request.id, 'Requested content digest differs');
  }
  return success(value);
}

/** True when the kind matches (if given) and the search text appears in the readable fields. */
function matches(
  value: Preset,
  query: Query,
): boolean {
  if (query.kind && value.kind !== query.kind) {
    return false;
  }
  return searchable(value).includes(query.search.toLowerCase());
}

/** The lowercased text searched: id, title, description and the recipe family (empty for themes). */
function searchable(value: Preset): string {
  const family = value.kind === 'recipe' ? value.payload.family : '';
  return [value.id, value.title, value.description, family].join(' ').toLowerCase();
}

/** Orders by `kind/id`, then by version (earliest first). */
function compare(
  left: Preset,
  right: Preset,
): number {
  const identity = `${left.kind}/${left.id}`.localeCompare(`${right.kind}/${right.id}`, 'en');
  if (identity !== 0) {
    return identity;
  }
  return compareVersions(left.version, right.version);
}

/** The summary of a preset: its pin and readable metadata, never the payload. */
function summarize(value: Preset): Summary {
  const family = value.kind === 'recipe' ? value.payload.family : null;
  return { pin: pinOf(value), title: value.title, description: value.description, family };
}
