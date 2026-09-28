/*
 * Produces one artifact from a parsed export request: lease the revision, check it, select the
 * scope, check resources, plan PDF pages, check sizes, run the format handler, then release the
 * lease. Every step returns a Result; the lease is released exactly once on every path after
 * Export has read it from the acquire result (see `SnapshotLease`).
 */
import { failure } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { ProductionDependencies } from '../../contract/types.js';
import type {
  Artifact,
  Snapshot,
  Encoded,
  Selection,
  Identity,
  Box,
} from '../../contract/records/artifact.js';
import type { Page } from '../../contract/records/pages.js';
import type { ExportRequest, Cancellation } from '../../contract/records/input.js';
import { success, protect } from '../validation/outcomes.js';
import { selectScope, validBounds } from './scope.js';
import { planPages } from './pages.js';
import { matchesIdentity } from './identity.js';
import { checkSceneResources } from '../bundles/completeness.js';
import { PROJECTION_CAPACITY } from '../../contract/records/limits.js';

/** Media type and file extension for each format. */
const descriptors = {
  svg: ['image/svg+xml', 'svg'],
  png: ['image/png', 'png'],
  pdf: ['application/pdf', 'pdf'],
  html: ['text/html', 'html'],
  bundle: ['application/vnd.novakai.canvas+json', 'nvcanvas'],
} as const;

/**
 * Produces the artifact for one parsed request. Leases the revision once, encodes, then
 * releases the lease once, whether the export succeeded or failed. If reading `ok` or `value` of
 * the acquire result throws, there is no lease to release and the host reclaims it. Only reads;
 * a failed call is safe to retry after the host repairs its providers.
 *
 * @param request - The parsed export request.
 * @param deps - Snapshot reader, format handlers and hashing.
 * @param signal - Optional cancellation, checked before acquiring, before encoding and after
 * encoding.
 * @returns The artifact, or a failure. A throw while acquiring or encoding becomes
 * `encoding-failed`; a throw while releasing becomes `cleanup-failed` (a failure returned by
 * `release` keeps its own code). When the export failed and releasing also failed, the release
 * failure is attached to the export failure as `cleanup`; when the export succeeded, a release
 * failure replaces the artifact.
 * @throws Rejects only if reading `signal.aborted`, or a field of a provider's returned result,
 * throws. `createExport` turns that rejection into `encoding-failed`.
 */
export async function produce(
  request: ExportRequest,
  deps: ProductionDependencies,
  signal?: Cancellation,
): Promise<Result<Artifact>> {
  if (signal?.aborted) return cancelled('before acquiring a revision');
  const acquired = await protect(
    /** Acquires the lease for the requested revision. */ () =>
      deps.snapshots.acquire(request.identity),
  );
  if (!acquired.ok) return acquired;
  const lease = acquired.value;
  const encoded = await protect(
    /** Renders and encodes the leased snapshot. */ () =>
      renderSnapshot(lease.snapshot, request, deps, signal),
  );
  const released = await protect(
    /** Releases the lease. */ () => lease.release(),
    'cleanup-failed',
  );
  return settle(encoded, released);
}

/**
 * Combines the export result with the release result. When the export failed, its failure stays
 * the primary failure and a release failure is attached to it as `cleanup`. When the export
 * succeeded, a release failure is returned instead of the artifact.
 */
function settle(
  result: Result<Artifact>,
  cleanup: Result<void>,
): Result<Artifact> {
  if (cleanup.ok) return result;
  if (result.ok) return cleanup;
  return { ok: false, error: { ...result.error, cleanup: cleanup.error } };
}

/** Checks the snapshot is the requested revision and selects the scope before any handler runs. */
async function renderSnapshot(
  snapshot: Snapshot,
  request: ExportRequest,
  deps: ProductionDependencies,
  signal?: Cancellation,
): Promise<Result<Artifact>> {
  if (!matchesIdentity(snapshot, request))
    return failure(
      'snapshot-mismatch',
      'identity',
      'Snapshot does not match the requested revision and projection',
    );
  const selected = selectScope(snapshot, request.scope);
  if (!selected.ok) return selected;
  return encodeSelection(snapshot, request, deps, selected.value, signal);
}

/**
 * Checks that every needed resource is present and plans PDF pages. These checks run for every
 * format, including host-supplied handlers.
 */
async function encodeSelection(
  snapshot: Snapshot,
  request: ExportRequest,
  deps: ProductionDependencies,
  selection: Selection,
  signal?: Cancellation,
): Promise<Result<Artifact>> {
  const invalid = checkSceneResources(snapshot);
  if (!invalid.ok) return invalid;
  const pages = pagesForFormat(selection, request, snapshot.identity);
  if (!pages.ok) return pages;
  return allocateAndEncode(snapshot, request, deps, selection, pages.value, signal);
}

/** Plans pages for PDF only; every other format gets an empty page list. */
function pagesForFormat(
  selection: Selection,
  request: ExportRequest,
  identity: Identity,
): Result<readonly Page[]> {
  if (request.format !== 'pdf') return success([]);
  return planPages(selection, request, identity);
}

/** Checks sizes, then runs the format handler. */
async function allocateAndEncode(
  snapshot: Snapshot,
  request: ExportRequest,
  deps: ProductionDependencies,
  selection: Selection,
  pages: readonly Page[],
  signal?: Cancellation,
): Promise<Result<Artifact>> {
  const checked = checkAllocation(snapshot, request, selection.bounds);
  if (!checked.ok) return checked;
  return runEncoder(snapshot, request, deps, selection, pages, signal);
}

/**
 * Rejects bounds that are not finite and positive, and bundles for one section
 * (`invalid-input`), then checks the scene counts and raster size.
 */
function checkAllocation(
  snapshot: Snapshot,
  request: ExportRequest,
  box: Box,
): Result<void> {
  if (!validBounds(box))
    return failure('invalid-input', 'scene.bounds', 'Scene bounds must be finite and positive');
  if (isSectionBundle(request))
    return failure('invalid-input', 'scope', 'Portable bundles require the whole collection');
  return checkCounts(snapshot, request, box);
}

/** Whether a bundle was requested for one section; bundles always cover the whole collection. */
function isSectionBundle(request: ExportRequest): boolean {
  return request.format === 'bundle' && request.scope.kind !== 'all';
}

/**
 * Checks the whole scene's section, node and wire counts against the projection capacity
 * (`limit-exceeded`), and for PNG the raster size at the requested scale, rounded up the way the
 * encoder rounds it.
 */
function checkCounts(
  snapshot: Snapshot,
  request: ExportRequest,
  box: Box,
): Result<void> {
  const counts = [
    snapshot.scene.sections.length / PROJECTION_CAPACITY.maxSections,
    snapshot.scene.sections.flatMap(/** The section's nodes. */ (section) => section.nodes).length /
      PROJECTION_CAPACITY.maxNodes,
    snapshot.scene.sections.flatMap(/** The section's wires. */ (section) => section.wires).length /
      PROJECTION_CAPACITY.maxWires,
  ];
  if (counts.some(/** Whether this count is over its limit. */ (ratio) => ratio > 1))
    return failure('limit-exceeded', 'scene', 'Scene exceeds the owning capability limits');
  if (request.format !== 'png') return success(undefined);
  const width = Math.ceil(box.width * request.scale);
  const height = Math.ceil(box.height * request.scale);
  return checkRaster(width, height);
}

/**
 * Checks a raster size against the native limits. Callers pass sizes already rounded the way
 * the PNG encoder rounds them.
 *
 * @param width - Raster width in pixels.
 * @param height - Raster height in pixels.
 * @returns Success, or `limit-exceeded` when a side is over 8,192 pixels or the area is over 64
 * million pixels.
 * @throws Never.
 */
function checkRaster(
  width: number,
  height: number,
): Result<void> {
  if (Math.max(width, height) > 8192 || width * height > 64000000)
    return failure(
      'limit-exceeded',
      'raster',
      'Raster exceeds 8192 pixels per side or 64 million pixels',
    );
  return success(undefined);
}

/**
 * Runs the format handler, checking cancellation before it starts. The handler gets
 * `{ aborted: false }` when the caller gave no signal.
 */
async function runEncoder(
  snapshot: Snapshot,
  request: ExportRequest,
  deps: ProductionDependencies,
  selection: Selection,
  pages: readonly Page[],
  signal?: Cancellation,
): Promise<Result<Artifact>> {
  if (signal?.aborted) return cancelled('before encoding');
  const result = await deps.formats[request.format].encode({
    snapshot,
    selection,
    request,
    pages,
    signal: signal ?? { aborted: false },
  });
  if (!result.ok) return result;
  return finish(result.value, snapshot, request, deps, signal);
}

/**
 * Turns handler output into the artifact: checks cancellation again, limits the bytes to 128
 * MiB, takes the bytes through their own `slice()` (a copy for a plain `Uint8Array`; a `Buffer`
 * shares memory with the handler's buffer), adds media type, extension and the digest of the
 * handler's bytes, and shallow-copies the identity and scope. No time or random value is added,
 * so repeated exports can be byte-identical.
 */
function finish(
  encoded: Encoded,
  snapshot: Snapshot,
  request: ExportRequest,
  deps: ProductionDependencies,
  signal?: Cancellation,
): Result<Artifact> {
  if (signal?.aborted) return cancelled('after encoding');
  if (encoded.bytes.byteLength > 128 * 1024 * 1024)
    return failure('limit-exceeded', 'bytes', 'Artifact exceeds 128 MiB');
  const [mediaType, extension] = descriptors[request.format];
  return success({
    ...encoded,
    bytes: encoded.bytes.slice(),
    schemaVersion: 1,
    mediaType,
    extension,
    digest: deps.encoding.hash(encoded.bytes),
    identity: { ...snapshot.identity },
    scope: { ...request.scope },
  });
}

/** The `cancelled` failure; `when` completes the message "Export was cancelled …". */
function cancelled(when: string): Result<never> {
  return failure('cancelled', '$', `Export was cancelled ${when}`);
}
