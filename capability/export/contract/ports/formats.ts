import type { Result } from '../errors.js';
import type { Snapshot, Selection, Encoded } from '../records/artifact.js';
import type { ExportRequest, Cancellation } from '../records/input.js';
import type { Page } from '../records/pages.js';

/**
 * What a format handler receives: one revision-pinned snapshot, already checked against the
 * request, scope and limits.
 */
export interface RenderInput {
  /** The retained revision. */
  readonly snapshot: Snapshot;
  /** The sections in scope and their bounds. */
  readonly selection: Selection;
  /** The parsed request, with defaults filled in. */
  readonly request: ExportRequest;
  /** The planned PDF pages; empty for every other format. */
  readonly pages: readonly Page[];
  /** Cancellation to observe between stages (`{ aborted: false }` when the caller gave none). */
  readonly signal: Cancellation;
}

/**
 * Encodes one format. Handlers never write to the workspace. Export calls `encode` once per
 * export, and a retry calls it again. The built-in handlers keep no state between calls, so there
 * is nothing to recover.
 */
export interface FormatHandler {
  /**
   * Encodes the input.
   *
   * @param input - The checked render input.
   * @returns The bytes, pages and warnings, or a failure. A throw becomes `encoding-failed`.
   */
  encode(input: RenderInput): Promise<Result<Encoded>>;
}

/** One handler for each of the five formats: svg, png, pdf, html and bundle. */
export type FormatRegistry = Readonly<Record<ExportRequest['format'], FormatHandler>>;
