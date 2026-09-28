/*
 * The export seams: the rasterizer PNG export waits for, the guarded read of one leased blob, and
 * the export route the session calls. Declarations only; adapters/raster supplies the rasterizer,
 * core/export implements the rest and compose binds them. Export owns its failures; the caller
 * corrects its request or retries once the named dependency is restored.
 */
import type { Result } from '../errors.js';
import type { AssetResult, StoredBlob } from '../records/capabilities.js';
import type { StaticFile } from '../records/transport/server.js';

/**
 * The PNG rasterizer: Export encodes PNG only after it is initialized. The first `prepare` starts
 * the one initialization; later calls share that outcome, failure too. The export route asks for
 * it lazily, on the first PNG request.
 */
export interface Rasterizer {
  /**
   * Initializes the rasterizer once; later calls share that outcome. Fails with `unavailable` at
   * `export.png`.
   */
  prepare(): Promise<Result<void>>;
}

/** A guarded read of one leased blob; a throwing lease is reported as a failed read. */
export type LeaseRead = (digest: unknown, path: string) => AssetResult<StoredBlob>;

/** The export route: unknown input in, a file or a typed failure out; the HTTP route sends it. */
export interface ExportHandler {
  /**
   * Answers one export file. Fails with `invalid-input` for a refused request, `unavailable` at
   * `export.png` when the rasterizer cannot start, and otherwise as `exportRouteFailure` of
   * Export's refusal (Export's diagnostic kept as source): `cancelled` stays `cancelled`, an input
   * refusal is `invalid-input`, and `encoding-failed`, `cleanup-failed` or `resource-rejected` is
   * `unavailable`.
   */
  invoke(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Result<StaticFile>>;
}
