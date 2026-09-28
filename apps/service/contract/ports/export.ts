/*
 * Why this file exists
 *
 * `POST /api/v1/export` asks for one saved collection as a file, for example `my-diagram` at
 * revision 3 as a PNG. The session passes the request on and gets back a file, or the mistake
 * found.
 *
 * This file declares the exporter (`Exporter`), the PNG encoder it starts on first use
 * (`PngEncoder`), and how it reads a stored font or image it has put on hold (`LeaseRead`).
 * core/export builds the exporter. An export only reads; it never changes the workspace.
 */
import type { Result } from '../errors.js';
import type { AssetResult, StoredBlob } from '../records/capability-types.js';
import type { SentFile } from '../records/transport/server.js';

/**
 * Starts Export's PNG encoder (it turns an SVG drawing into PNG bytes). It starts once, on the
 * first PNG request; later requests share that outcome, even a failed one.
 */
export interface PngEncoder {
  /**
   * Starts the encoder the first time; later calls share that outcome. Fails with `unavailable`
   * at `export.png`.
   */
  prepare(): Promise<Result<void>>;
}

/**
 * Reads one held font or image (a lease stops its removal). `digest` is text; Assets checks it.
 * A failed or throwing read is reported at `failurePath`, such as `resources.logo`.
 */
export type LeaseRead = (digest: string, failurePath: string) => AssetResult<StoredBlob>;

/** Turns one export request into one file. The HTTP route then sends that file. */
export interface Exporter {
  /**
   * Makes one export file from the request as sent. Fails with `invalid-input` for a bad request,
   * `unavailable` when the PNG encoder can't start or Export can't read a file, encode or clean up,
   * and `cancelled` when the export was stopped. Export's own failure is kept as the source.
   */
  exportFile(
    input: unknown,
    signal: AbortSignal,
  ): Promise<Result<SentFile>>;
}
