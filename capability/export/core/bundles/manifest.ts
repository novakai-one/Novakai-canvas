/*
 * Bundle building. A bundle must rebuild the exact collection: its DSL source plus the manual
 * snapshot, read back, must equal the original apart from the revision. Output is canonical
 * JSON with sorted resources, so repeated exports are byte-identical.
 */
import type { Snapshot, Encoded, Collection } from '../../contract/records/artifact.js';
import type { TransferDependencies } from '../../contract/types.js';
import type { Cancellation } from '../../contract/records/input.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { parse, success } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';
import { captureManual, overlayManual } from './manual.js';
import { inspectResources } from './resources.js';
import { bundleSchema } from '../../contract/records/bundle.js';

/**
 * Builds the bundle bytes for a snapshot: check resources, check cancellation, print the DSL,
 * prove the round trip, then serialize.
 *
 * @param snapshot - The leased snapshot.
 * @param deps - Documents, the owners' resource check and encoding.
 * @param signal - Cancellation, checked once after the resource check.
 * @returns The bundle as `Encoded` (no pages, no warnings), or a failure: a resource failure,
 * `cancelled`, a documents failure (passed through), `invalid-bundle` (not complete `canvas 1`
 * DSL, a failed round trip, or a bundle that fails its own schema) or `invalid-import` (the
 * manual snapshot does not fit the parsed collection).
 * @throws Whatever a provider (documents, resources, encoding) throws or rejects with, reading
 * `signal.aborted` throws, or {@link canonical} throws. It runs inside `produce`, so the public
 * `exportArtifact` returns `encoding-failed` instead. Building only reads and writes nothing;
 * the host repairs its providers and retries.
 */
export async function buildBundle(
  snapshot: Snapshot,
  deps: TransferDependencies,
  signal: Cancellation,
): Promise<Result<Encoded>> {
  const resources = await inspectResources(snapshot.resources, deps);
  if (!resources.ok) return resources;
  return afterResources(snapshot, deps, signal);
}

/** Stops if cancelled, otherwise prints the collection as DSL and continues. */
function afterResources(
  snapshot: Snapshot,
  deps: TransferDependencies,
  signal: Cancellation,
): Result<Encoded> {
  if (signal.aborted)
    return failure('cancelled', '$', 'Export cancelled after resource inspection');
  const source = deps.documents.print(snapshot.collection);
  if (!source.ok) return source;
  return encodeBundle(snapshot, source.value, deps);
}

/**
 * Requires complete `canvas 1` DSL (after leading whitespace), proves the round trip, then
 * serializes.
 */
function encodeBundle(
  snapshot: Snapshot,
  source: string,
  deps: TransferDependencies,
): Result<Encoded> {
  if (!/^canvas\s+1(?:\s|$)/.test(source.trimStart()))
    return failure('invalid-bundle', 'source', 'Bundle requires complete canvas 1 DSL');
  const roundtrip = checkRoundtrip(snapshot.collection, source, snapshot, deps);
  if (!roundtrip.ok) return roundtrip;
  return serializeBundle(snapshot, source, deps);
}

/**
 * Parses the DSL, applies the manual snapshot captured from the original, and compares the result
 * with the original collection (not just with the printer's own view).
 */
function checkRoundtrip(
  original: Collection,
  source: string,
  snapshot: Snapshot,
  deps: TransferDependencies,
): Result<void> {
  const parsed = deps.documents.parse(source, snapshot.resources);
  if (!parsed.ok) return parsed;
  const overlaid = overlayManual(parsed.value, captureManual(original));
  if (!overlaid.ok) return overlaid;
  return compareCollection(original, overlaid.value, deps);
}

/**
 * Reads the rebuilt collection and compares it with the original as canonical JSON, ignoring
 * only the revision.
 */
function compareCollection(
  original: Collection,
  candidate: unknown,
  deps: TransferDependencies,
): Result<void> {
  const valid = deps.documents.read(candidate);
  if (!valid.ok) return valid;
  if (canonical({ ...original, revision: 0 }) !== canonical({ ...valid.value, revision: 0 }))
    return failure(
      'invalid-bundle',
      'source',
      'DSL and manual snapshot cannot reconstruct the collection exactly',
    );
  return success(undefined);
}

/**
 * Serializes the bundle: resources sorted by kind and digest, digests of the source and the
 * canonical manual snapshot, checked against the bundle schema, written as canonical JSON.
 */
function serializeBundle(
  snapshot: Snapshot,
  source: string,
  deps: TransferDependencies,
): Result<Encoded> {
  const manual = captureManual(snapshot.collection);
  const resources = snapshot.resources
    .map(
      /** The resource as a manifest record, with its bytes as base64. */ (item) => ({
        kind: item.kind,
        digest: item.digest,
        mediaType: item.mediaType,
        metadata: item.metadata,
        base64: deps.encoding.base64(item.bytes),
      }),
    )
    .sort(
      /** Orders records by their `kind:digest` key. */ (a, b) =>
        `${a.kind}:${a.digest}`.localeCompare(`${b.kind}:${b.digest}`),
    );
  const value = {
    format: 'novakai.canvas.bundle',
    schemaVersion: 1,
    identity: snapshot.identity,
    source,
    sourceDigest: deps.encoding.hash(deps.encoding.utf8(source)),
    manual,
    manualDigest: deps.encoding.hash(deps.encoding.utf8(canonical(manual))),
    resources,
  };
  const parsed = parse(bundleSchema, value, 'invalid-bundle');
  if (!parsed.ok) return parsed;
  return success({ bytes: deps.encoding.utf8(canonical(parsed.value)), pages: [], warnings: [] });
}
