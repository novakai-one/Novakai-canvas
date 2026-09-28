/*
 * Import preparation: turns bundle bytes into a collection ready for Authoring to admit under a
 * new collection ID. Steps: inspect the bundle, rebuild the collection from its DSL, apply the
 * manual snapshot, validate through Model, check the pinned resources, then move it to the new
 * collection ID at revision 0. Nothing is written; Authoring checks the target is still absent
 * and admits the collection and its resources atomically.
 */
import type {
  ImportRequest,
  BundleInspection,
  PreparedImport,
} from '../../contract/records/bundle.js';
import type { Collection } from '../../contract/records/artifact.js';
import type { ImportDependencies } from '../../contract/types.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { success, protect } from '../validation/outcomes.js';
import { inspectBundle } from './inspect.js';
import { overlayManual } from './manual.js';
import { checkCollectionResources } from './completeness.js';

/**
 * Prepares an import from a parsed request. Export only reads and writes nothing, so a rejected
 * import is safe to retry; with deterministic providers a repeat gives the same result.
 * Authoring owns admission.
 *
 * @param request - The parsed request: bundle bytes and the new collection ID.
 * @param deps - Encoding, the resource owners' check and the documents provider.
 * @returns The prepared import, or the first failure, in the order the checks run:
 * 1. an inspection failure, unchanged (see `inspectBundle`);
 * 2. `invalid-import` at `targetCollectionId` when the new ID equals the bundle's collection ID;
 * 3. a failure returned by `documents.parse`, unchanged;
 * 4. `invalid-import` at `source` when the parsed DSL has a different collection ID;
 * 5. `invalid-import` when the manual snapshot does not fit the collection;
 * 6. a failure returned by `documents.read` for the overlaid collection, unchanged;
 * 7. `resource-rejected` when a pinned theme or asset is not among the bundle's resources;
 * 8. a failure returned by `documents.read` for the collection under the new ID at revision 0,
 *    unchanged.
 * @throws Never. Any throw or rejection inside, including a provider's, becomes
 * `invalid-import` at `$`.
 */
export async function prepareImport(
  request: ImportRequest,
  deps: ImportDependencies,
): Promise<Result<PreparedImport>> {
  return protect(
    /** Runs the checked preparation. */ () => prepareChecked(request, deps),
    'invalid-import',
  );
}

/** Inspects the bundle and rejects a target ID equal to the bundle's own collection ID. */
async function prepareChecked(
  request: ImportRequest,
  deps: ImportDependencies,
): Promise<Result<PreparedImport>> {
  const inspection = await inspectBundle(request.bytes, deps);
  if (!inspection.ok) return inspection;
  const sameCollection = request.targetCollectionId === inspection.value.identity.collectionId;
  if (sameCollection)
    return failure(
      'invalid-import',
      'targetCollectionId',
      'Import requires a new collection namespace',
    );
  return reconstruct(request, inspection.value, deps);
}

/**
 * Rebuilds the collection from the bundle's DSL through the documents provider, and checks it
 * is the collection the bundle names.
 */
function reconstruct(
  request: ImportRequest,
  inspection: BundleInspection,
  deps: ImportDependencies,
): Result<PreparedImport> {
  const parsed = deps.documents.parse(inspection.source, inspection.resources);
  if (!parsed.ok) return parsed;
  if (parsed.value.id !== inspection.identity.collectionId)
    return failure('invalid-import', 'source', 'DSL collection does not match bundle identity');
  return restore(request, inspection, parsed.value, deps);
}

/**
 * Applies the manual snapshot, then validates the result through Model while it still has its
 * original collection ID.
 */
function restore(
  request: ImportRequest,
  inspection: BundleInspection,
  collection: Collection,
  deps: ImportDependencies,
): Result<PreparedImport> {
  const overlaid = overlayManual(collection, inspection.manual);
  if (!overlaid.ok) return overlaid;
  const admitted = deps.documents.read(overlaid.value);
  if (!admitted.ok) return admitted;
  return remapNamespace(request, inspection, admitted.value, deps);
}

/**
 * Checks the pinned resources, then gives the collection the new ID at revision 0 and validates
 * it again through Model. Local IDs inside the collection do not change; only the collection
 * ID, and so every fully scoped address, does. The returned resources are the inspection's own.
 */
function remapNamespace(
  request: ImportRequest,
  inspection: BundleInspection,
  collection: Collection,
  deps: ImportDependencies,
): Result<PreparedImport> {
  const completeness = checkCollectionResources(collection, inspection.resources);
  if (!completeness.ok) return completeness;
  const candidate = deps.documents.read({
    ...collection,
    id: request.targetCollectionId,
    revision: 0,
  });
  if (!candidate.ok) return candidate;
  return success({
    original: inspection.identity,
    target: { ...inspection.identity, collectionId: request.targetCollectionId, revision: 0 },
    collection: candidate.value,
    resources: inspection.resources,
    expected: 'absent',
    sourceDigest: inspection.sourceDigest,
    warnings: [],
  });
}
