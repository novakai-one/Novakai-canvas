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
import { success, type Failure } from '../../contract/errors.js';

/** Export's `resource-rejected` refusal for a resource the snapshot did not retain. */
const unretainedResourceRefusal: ExportDiagnostic = Object.freeze({
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
    /** Approves the requested batch when the snapshot kept every resource in it. */
    async inspect(requested) {
      if (hasUnretainedResource(requested, retained)) {
        return unretainedResourceFailure();
      }
      return success(requested);
    },
  };
}

/** Whether any requested resource differs from every resource the snapshot kept. */
function hasUnretainedResource(
  requested: readonly Resource[],
  retained: readonly Resource[],
): boolean {
  return requested.some((resource) => isUnretained(resource, retained));
}

/** Whether `resource` equals none of the resources the snapshot kept. */
function isUnretained(
  resource: Resource,
  retained: readonly Resource[],
): boolean {
  const match = retained.find((candidate) => sameResource(resource, candidate));
  return match === undefined;
}

/** Whether two resources have the same kind, digest, media type, bytes and metadata. */
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

/** Whether two byte arrays hold the same bytes in the same order. */
function sameBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
}

/** Whether two metadata records have the same keys, each with the same value. */
function sameMetadata(
  left: Resource['metadata'],
  right: Resource['metadata'],
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) {
    return false;
  }
  return leftEntries.every(([key, expected]) => hasEntry(right, key, expected));
}

/** Whether `record` holds `key` with exactly `expected`. */
function hasEntry(
  record: Resource['metadata'],
  key: string,
  expected: unknown,
): boolean {
  return Object.hasOwn(record, key) && Object.is(record[key], expected);
}

/** Makes Export's `resource-rejected` refusal, for a resource the snapshot didn't keep. */
function unretainedResourceFailure(): Failure<ExportDiagnostic> {
  return { ok: false, error: unretainedResourceRefusal };
}
