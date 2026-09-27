/*
 * Export vocabulary: the request the service boundary parses, the handler the workspace
 * publishes, and the capability types core/export speaks in. The request schema is plain zod
 * replicating the service's own grammar; capability types arrive as type-only re-exports so core
 * stays inside every capability's public entry. Declarations only; core/export owns the rules.
 */
import { z } from 'zod';
import type { Result as AssetResult, StoredBlob } from '@novakai/canvas-assets';
import type { Diagnostic as ExportDiagnostic } from '@novakai/canvas-export';
import type { Collection } from '../capabilities.js';
import type { WorkspaceContents } from '../workspace/contents.js';
import type { RouteOutcome } from '../transport/protocol.js';

export type { ReadLease, Result as AssetResult, StoredBlob } from '@novakai/canvas-assets';
export type {
  Artifact,
  Diagnostic as ExportDiagnostic,
  Documents,
  ErrorCode as ExportErrorCode,
  MarkdownScope,
  Resource,
  Resources,
  Result as ExportResult,
  Snapshot as ExportSnapshot,
  SnapshotLease,
} from '@novakai/canvas-export';
export type { Catalog, ThemePreset } from '@novakai/canvas-templates';

/** Collection and section ids share one identifier grammar at the export boundary. */
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

/**
 * What to export: identity, format and scope. A failure here is an unsupported request.
 * Revision is any non-negative integer; `.int()` is avoided because it also caps at safe
 * integers, which the boundary has never done. Extra keys are ignored, never rejected.
 */
export const exportSelection = z.object({
  identity: z.object({
    collectionId: identifier,
    revision: z.number().nonnegative().refine(Number.isInteger),
  }),
  format: z.enum(['dsl', 'svg', 'png', 'markdown']),
  scope: z.union([
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('section'), id: identifier }),
  ]),
});

/** A complete export request; scale defaults to 1 and is judged only after the selection. */
export const exportRequest = exportSelection.extend({
  scale: z.number().min(1).max(4).default(1),
});

/** One checked export request. */
export type ExportRequest = z.infer<typeof exportRequest>;

/** The failure arm of an Export result. */
export interface ExportFailure {
  readonly ok: false;
  readonly error: ExportDiagnostic;
}

/** The requested collection at its requested revision, with the workspace view it came from. */
export interface SelectedCollection {
  readonly collection: Collection;
  readonly view: WorkspaceContents;
}

/** A guarded read of one leased blob; a throwing lease is reported as a failed read. */
export type LeaseRead = (digest: unknown, path: string) => AssetResult<StoredBlob>;

/** The export route: unknown input in, a file or a typed failure out. */
export interface ExportHandler {
  invoke(
    input: unknown,
    signal: AbortSignal,
  ): Promise<RouteOutcome>;
}
