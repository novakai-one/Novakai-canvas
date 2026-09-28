/*
 * Why this file exists
 *
 * `POST /api/v1/export` asks for one saved collection as a file, for example `my-diagram` at
 * revision 3 as a PNG. The session passes the request on and gets back a file, or the mistake
 * found.
 *
 * This file declares the export route (`ExportRoute`), the PNG encoder it starts on first use
 * (`Rasterizer`), and how it reads a stored font or image it has put on hold (`LeaseRead`).
 * core/export builds the route. An export only reads; it never changes the workspace.
 */
import type { Result } from '../errors.js';
import type { AssetResult, StoredBlob } from '../records/capabilities.js';
import type { StaticFile } from '../records/transport/server.js';

/**
 * The PNG encoder. Export can encode a PNG only after it has started. It starts once, on the first
 * PNG request; later requests share that outcome, even a failed one.
 */
export interface Rasterizer {
  /**
   * Starts the encoder the first time; later calls share that outcome. Fails with `unavailable`
   * at `export.png`.
   */
  prepare(): Promise<Result<void>>;
}

/**
 * Reads one stored font or image while the export holds it (a lease), so it can't be removed.
 * A failed or throwing read is reported at `failurePath`, such as `resources.logo`.
 */
export type LeaseRead = (digest: unknown, failurePath: string) => AssetResult<StoredBlob>;

/** The export route: turns one export request into one file. The HTTP route sends that file. */
export interface ExportRoute {
  /**
   * Makes one export file from the request as sent. Fails with `invalid-input` for a bad request,
   * `unavailable` when the PNG encoder can't start or Export can't read a file, encode or clean up,
   * and `cancelled` when the export was stopped. Export's own failure is kept as the source.
   */
  invoke(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Result<StaticFile>>;
}
