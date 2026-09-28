/*
 * Why this file exists
 *
 * Before Export uses a file's bytes (a font, an image, a theme), it asks for them to be checked.
 * They must be exactly ones the render kept in its snapshot: same kind, hash, type, bytes, details.
 * A font with the right hash but a different family is refused, so nothing can pass as another.
 *
 * This file builds that checker for Export from the snapshot's list. A refusal is Export's own
 * `resource-rejected` record. It reads and writes nothing.
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
 * Gives back the checker Export calls before using any bytes (Export's `Resources`). It approves a
 * requested batch only when every resource in it equals one in `retained`, the snapshot's list;
 * otherwise it answers `resource-rejected`.
 */
export function buildResourceCheck(retained: readonly Resource[]): Resources {
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
