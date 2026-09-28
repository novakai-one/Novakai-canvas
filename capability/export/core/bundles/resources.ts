/*
 * Resource checks shared by bundle building and inspection: Export's own size and integrity
 * checks first, then the resource owners' check, then a check that the owners' returned list
 * matches the input list as it is after the owners' call.
 */
import type { Resource } from '../../contract/records/resource.js';
import type { InspectionDependencies } from '../../contract/types.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { success } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';

/**
 * Checks resources, then hands them to the owners' `inspect`, then checks the owners returned
 * the same content.
 *
 * The owners must not change the input list or its bytes. Export cannot prove that: both sides
 * are compared after the owners return, so an in-place change to the input is compared in its
 * changed state and is not detected.
 *
 * @param resources - The resources to check.
 * @param deps - Hashing, base64 and the owners' `Resources.inspect`.
 * @returns The owners' resources, or a failure: `limit-exceeded` (over 2,000 resources, or one
 * over 20 MiB), `invalid-bundle` (a repeated kind and digest, or bytes that do not match their
 * digest), the owners' own failure (passed through), or `resource-rejected` if the owners'
 * list differs in content, metadata or order. Each returned record is a shallow copy (metadata
 * is not deep-copied) whose bytes come from the owner bytes' own `slice()`: a copy for a plain
 * `Uint8Array`, but a `Buffer`'s `slice()` shares memory with the owner's buffer.
 * @throws Whatever the owners' `inspect`, `hash`, `base64`, a bytes `slice()` or
 * {@link canonical} throws (for example a getter or a cyclic metadata value).
 * The enclosing public operation turns a throw into a failure: `exportArtifact` (through
 * `produce`) into `encoding-failed`, `inspectBundle` into `invalid-bundle`, `prepareImport` into
 * `invalid-import`. The host repairs its providers and retries; nothing here needs recovery.
 */
export async function inspectResources(
  resources: readonly Resource[],
  deps: InspectionDependencies,
): Promise<Result<readonly Resource[]>> {
  const valid = checkResources(resources, deps);
  if (!valid.ok) return valid;
  const admitted = await deps.resources.inspect(resources);
  if (!admitted.ok) return admitted;
  return compareAdmission(resources, admitted.value, deps);
}

/** Checks the resource count, then repeated kind-and-digest keys, then sizes and digests. */
function checkResources(
  resources: readonly Resource[],
  deps: InspectionDependencies,
): Result<void> {
  if (resources.length > 2000)
    return failure('limit-exceeded', 'resources', 'Transfer exceeds 2000 resources');
  const keys = resources.map(
    /** The resource's `kind:digest` key. */ (item) => `${item.kind}:${item.digest}`,
  );
  if (new Set(keys).size !== keys.length)
    return failure('invalid-bundle', 'resources', 'Duplicate resource kind and digest');
  return checkBytes(resources, deps);
}

/**
 * Checks sizes until the first resource over 20 MiB; if none is, checks digests until the first
 * mismatch. No owner has decoded a font or image yet.
 */
function checkBytes(
  resources: readonly Resource[],
  deps: InspectionDependencies,
): Result<void> {
  if (
    resources.some(
      /** Whether the resource is over 20 MiB. */ (item) =>
        item.bytes.byteLength > 20 * 1024 * 1024,
    )
  )
    return failure('limit-exceeded', 'resources.bytes', 'Resource exceeds 20 MiB');
  if (
    resources.some(
      /** Whether the resource's bytes do not match its digest. */ (item) =>
        deps.encoding.hash(item.bytes) !== item.digest,
    )
  )
    return failure(
      'invalid-bundle',
      'resources.digest',
      'Resource bytes do not match their digest',
    );
  return success(undefined);
}

/**
 * Compares the owners' result with the input list as it is now (canonical JSON, bytes as
 * base64). The owners may return new objects, but content, metadata and order must be the same.
 */
function compareAdmission(
  original: readonly Resource[],
  admitted: readonly Resource[],
  deps: InspectionDependencies,
): Result<readonly Resource[]> {
  const fingerprint =
    /**
     * The list as canonical JSON with each record's bytes replaced by base64. Key order inside a
     * record does not matter; list order does.
     */
    (items: readonly Resource[]): string =>
      canonical(
        items.map(
          /** The resource with its bytes as base64. */ (item) => ({
            ...item,
            bytes: deps.encoding.base64(item.bytes),
          }),
        ),
      );
  if (fingerprint(original) !== fingerprint(admitted))
    return failure(
      'resource-rejected',
      'resources',
      'Owner inspector changed the transfer content',
    );
  return success(
    admitted.map(
      /** The resource with its bytes copied by their own `slice()`. */ (item) => ({
        ...item,
        bytes: item.bytes.slice(),
      }),
    ),
  );
}
