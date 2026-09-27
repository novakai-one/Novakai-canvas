/*
 * Export's public boundary: revision-pinned artifacts (SVG, PNG, PDF, HTML and portable
 * bundles), bundle inspection, uncommitted import preparation and Markdown text. Only the
 * functions and types below are public; schemas and core helpers stay internal. Every
 * operation only reads, so a failed call is safe to retry; the host owns provider repair,
 * writes and import admission.
 */
export { createExport } from './api.js';
export { composeExport, initializeRaster } from './compose.js';
export { formatMarkdown } from './markdown.js';
export type { MarkdownScope } from './markdown.js';
export type { ExportOwners, ExportBindings } from './compose.js';
export type { Export, Dependencies, TransferDependencies } from './types.js';
export type { Result, Diagnostic, ErrorCode } from './errors.js';
export type { ExportRequest, Scope, Format, Cancellation } from './records/input.js';
export type { Snapshot, Identity, Selection, Artifact, Encoded } from './records/artifact.js';
export type { Resource } from './records/resource.js';
export type { Bundle, BundleInspection, PreparedImport, ImportRequest } from './records/bundle.js';
export type { ManualSnapshot } from './records/manual.js';
export type { Page } from './records/pages.js';
export type { SnapshotReader, SnapshotLease } from './ports/snapshot.js';
export type { Documents } from './ports/documents.js';
export type { Resources } from './ports/resources.js';
export type { Encoding } from './ports/encoding.js';
export type { FormatHandler, FormatRegistry, RenderInput } from './ports/formats.js';
export type { SceneRenderer } from './render-types.js';
