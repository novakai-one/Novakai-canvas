/*
 * Bundle inspection: bytes → UTF-8 text → JSON → bundle shape → digests → decoded resources →
 * the owners' resource check. Nothing is trusted or admitted until every step has passed.
 */
import { bundleSchema } from '../../contract/records/bundle.js';
import type { Bundle, BundleInspection } from '../../contract/records/bundle.js';
import type { Resource } from '../../contract/records/resource.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { InspectionDependencies } from '../../contract/types.js';
import { parse, success } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';
import { inspectResources } from './resources.js';

/**
 * Inspects bundle bytes without admitting anything.
 *
 * @param input - Unknown input; must be a `Uint8Array` of at most 128 MiB.
 * @param deps - Encoding and the owners' resource check.
 * @returns What the bundle contains, or the first failure: `invalid-input` / `limit-exceeded`
 * for the bytes, `invalid-bundle` for text, shape, digest or base64 problems, `limit-exceeded`
 * for DSL over 16 MiB, or a resource failure.
 * @throws SyntaxError from `JSON.parse` when the text is not JSON, whatever the input's own
 * `slice()` throws (see {@link readBytes}), and anything a provider throws; the public
 * `inspectBundle` and `prepareImport` turn these into `invalid-bundle` / `invalid-import`. The
 * host repairs its providers and retries; inspection writes nothing.
 */
export async function inspectBundle(
  input: unknown,
  deps: InspectionDependencies,
): Promise<Result<BundleInspection>> {
  const bytes = readBytes(input);
  if (!bytes.ok) return bytes;
  const text = deps.encoding.text(bytes.value);
  if (!text.ok) return text;
  return inspectText(text.value, deps);
}

/**
 * Checks the input is a byte buffer of at most 128 MiB, before any decoding.
 *
 * @param input - Unknown input.
 * @returns The result of the input's own `slice()`, or `invalid-input` (not a `Uint8Array`) /
 * `limit-exceeded`. For a plain `Uint8Array` that is a copy; a `Buffer` (a `Uint8Array`
 * subclass) returns a view that shares memory with the input.
 * @throws Whatever the input throws while being checked or copied: a proxy's `getPrototypeOf`
 * trap during `instanceof`, or an overridden `byteLength` getter or `slice()`.
 */
export function readBytes(input: unknown): Result<Uint8Array> {
  if (!(input instanceof Uint8Array))
    return failure('invalid-input', 'bytes', 'Expected a byte buffer');
  if (input.byteLength > 128 * 1024 * 1024)
    return failure('limit-exceeded', 'bytes', 'Transfer exceeds 128 MiB');
  return success(input.slice());
}

/**
 * Parses the JSON text as a bundle (`invalid-bundle` if the shape is wrong), checks its digests,
 * then decodes and checks its resources. `JSON.parse` may throw; see {@link inspectBundle}.
 */
async function inspectText(
  text: string,
  deps: InspectionDependencies,
): Promise<Result<BundleInspection>> {
  const parsed = parse(bundleSchema, JSON.parse(text), 'invalid-bundle');
  if (!parsed.ok) return parsed;
  const hashes = checkHashes(parsed.value, deps);
  if (!hashes.ok) return hashes;
  return inspectDecoded(parsed.value, deps);
}

/**
 * Checks the source and manual-snapshot digests separately (so a geometry change cannot hide
 * behind an unchanged DSL digest), then the 16 MiB limit on the source's UTF-8 bytes. Both
 * digests are always checked; neither check skips the other.
 */
function checkHashes(
  bundle: Bundle,
  deps: InspectionDependencies,
): Result<void> {
  const hashes = [
    deps.encoding.hash(deps.encoding.utf8(bundle.source)) === bundle.sourceDigest,
    deps.encoding.hash(deps.encoding.utf8(canonical(bundle.manual))) === bundle.manualDigest,
  ];
  if (!hashes.every(Boolean))
    return failure('invalid-bundle', 'digest', 'Source or manual snapshot hash mismatch');
  if (deps.encoding.utf8(bundle.source).byteLength > 16 * 1024 * 1024)
    return failure('limit-exceeded', 'source', 'DSL exceeds 16 MiB');
  return success(undefined);
}

/** Decodes every resource strictly, then runs the resource checks, then builds the result. */
async function inspectDecoded(
  bundle: Bundle,
  deps: InspectionDependencies,
): Promise<Result<BundleInspection>> {
  const decoded = decodeResources(bundle, deps);
  if (!decoded.ok) return decoded;
  const resources = await inspectResources(decoded.value, deps);
  if (!resources.ok) return resources;
  return success({
    identity: bundle.identity,
    source: bundle.source,
    sourceDigest: bundle.sourceDigest,
    manual: bundle.manual,
    resources: resources.value,
    counts: { resources: resources.value.length, sections: bundle.manual.sections.length },
  });
}

/** Decodes every resource first, then returns the first failure, or all decoded resources. */
function decodeResources(
  bundle: Bundle,
  deps: InspectionDependencies,
): Result<readonly Resource[]> {
  const decoded = bundle.resources.map(
    /** Decodes one bundle resource. */ (resource) => decodeResource(resource, deps),
  );
  const failed = decoded.find(/** Whether the resource failed to decode. */ (result) => !result.ok);
  if (failed && !failed.ok) return failed;
  return success(
    decoded.flatMap(
      /** The decoded resource; nothing for a failure. */ (result) =>
        result.ok ? [result.value] : [],
    ),
  );
}

/** Decodes one resource's base64 and keeps its owner metadata as it is. */
function decodeResource(
  resource: Bundle['resources'][number],
  deps: InspectionDependencies,
): Result<Resource> {
  const bytes = deps.encoding.decode(resource.base64);
  if (!bytes.ok) return bytes;
  return success({
    kind: resource.kind,
    digest: resource.digest,
    mediaType: resource.mediaType,
    metadata: resource.metadata,
    bytes: bytes.value,
  });
}
