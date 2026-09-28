/*
 * What a selection holds and reads: the bytes kept until commit and the preset records it depends
 * on. Pure; a malformed digest is `invalid-input` at `resources` (refusal.ts). Authoring owns the
 * lease, commit and recovery.
 */
import type {
  AuthoringResult,
  Catalog,
  Request,
  ResolvedResources,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import { removeDigestPrefix, type AuthoringDigest } from '../../../contract/brands.js';
import type { ResourceSelection } from '../../../contract/records/planning/selection.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import { checkedDigest, sortedDigests } from './digests.js';
import { themePresets } from './themes.js';

/**
 * Bytes held until commit: records, uploads and theme fonts sorted, then newly bound bytes in
 * binding order. Fails with `invalid-input` at `resources` when a digest is malformed.
 */
export function coverage(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  bound: ResolvedResources['assets'],
): AuthoringResult<readonly AuthoringDigest[]> {
  const held = sortedDigests([
    ...snapshot.records.flatMap((item) => item.resources),
    ...request.assets.map((item) => item.digest),
    ...themePresets(catalog).flatMap((item) => item.payload.fonts),
  ]);
  if (!held.ok) return held;
  const bytes = collect(Object.values(bound), (binding) =>
    checkedDigest(removeDigestPrefix(binding.digest)),
  );
  return andThen(bytes, (added) => success([...new Set([...held.value, ...added])]));
}

/** Every preset record, deleted ones included, is a read dependency of the selection. Cannot fail. */
export function presetReads(snapshot: Snapshot): ResourceSelection['reads'] {
  return snapshot.records
    .filter((item) => item.key.kind === 'preset')
    .map((item) => ({ key: item.key, version: item.version }));
}
