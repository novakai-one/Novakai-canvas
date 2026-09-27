/*
 * What a selection holds and reads: the bytes kept until commit and the preset records it depends
 * on. Pure; a malformed digest throws zod's error (select.ts turns it into `invalid-input`).
 * Authoring owns the lease, commit and recovery.
 */
import type {
  Catalog,
  Digest,
  Request,
  ResolvedResources,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { ResourceSelection } from '../../../contract/records/planning/planning.js';
import { authoringDigest } from '../../../contract/schemas.js';
import { bare, sortedDigests } from './digests.js';
import { themePresets } from './themes.js';

/**
 * Bytes held until commit: records, uploads and theme fonts sorted, then newly bound bytes in
 * binding order. Throws zod's error when a digest is malformed.
 */
export function coverage(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  bound: ResolvedResources['assets'],
): readonly Digest[] {
  const held = sortedDigests([
    ...snapshot.records.flatMap((item) => item.resources),
    ...request.assets.map((item) => item.digest),
    ...themePresets(catalog).flatMap((item) => item.payload.fonts),
  ]);
  const bytes = Object.values(bound).map((item) => authoringDigest.parse(bare(item.digest)));
  return [...new Set([...held, ...bytes])];
}

/** Every preset record, deleted ones included, is a read dependency of the selection. Cannot fail. */
export function presetReads(snapshot: Snapshot): ResourceSelection['reads'] {
  return snapshot.records
    .filter((item) => item.key.kind === 'preset')
    .map((item) => ({ key: item.key, version: item.version }));
}
