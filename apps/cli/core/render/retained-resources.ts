/*
 * What Export may read during one render: only resources equal, byte for byte and in metadata, to
 * the ones the snapshot retained. Pure; nothing is read or written. A refusal is Export's own
 * `resource-rejected` record; the caller rebuilds the snapshot and runs render:png again.
 */
import type { ExportDiagnostic, Resource, Resources } from '../../contract/records/foreign.js';
import { success } from '../../contract/errors.js';

/** Export's `resource-rejected` refusal for a resource the snapshot did not retain. */
const unretained: ExportDiagnostic = Object.freeze({
  code: 'resource-rejected',
  path: 'snapshot.resources',
  message: 'Resource differs from its owner-admitted snapshot',
  recovery: 'Rebuild the snapshot through its resource owners and retry.',
});

/**
 * Export's resource port over the snapshot's `retained` resources: it admits a batch only when each
 * resource equals a retained one, so no retained identity can be borrowed. Fails with
 * `resource-rejected`.
 */
export function resourceInspector(retained: readonly Resource[]): Resources {
  return {
    async inspect(items) {
      if (!items.every((item) => isRetained(item, retained)))
        return { ok: false, error: unretained };
      return success(items);
    },
  };
}

/** Whether `item` equals one retained resource. */
function isRetained(
  item: Resource,
  retained: readonly Resource[],
): boolean {
  return retained.some((candidate) => sameResource(item, candidate));
}

/** Same kind, digest, media type, bytes and metadata. */
function sameResource(
  left: Resource,
  right: Resource,
): boolean {
  return (
    left.kind === right.kind &&
    left.digest === right.digest &&
    left.mediaType === right.mediaType &&
    sameBytes(left.bytes, right.bytes) &&
    sameMetadata(left.metadata, right.metadata)
  );
}

/** Byte-for-byte equality. */
function sameBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The same keys, each with the same value. */
function sameMetadata(
  left: Resource['metadata'],
  right: Resource['metadata'],
): boolean {
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(([key, value]) => hasEntry(right, key, value))
  );
}

/** Whether `record` holds `key` with exactly `value`. */
function hasEntry(
  record: Resource['metadata'],
  key: string,
  value: unknown,
): boolean {
  return Object.hasOwn(record, key) && Object.is(record[key], value);
}
