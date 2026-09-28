/*
 * Why this file exists
 *
 * The CLI works with records other parts own. A `read` answer is about Model's `Collection`, and
 * a refused change carries the service's failure record. Copying those shapes would let them drift
 * apart from their owners.
 *
 * This file passes those types on, grouped by owner, so CLI core finds them in one place and never
 * imports another package. A few types at the end are cut out of an owner's type because the owner
 * gives that piece no name of its own. It declares types only.
 */
import type { TransportResponse, createHeadlessBindings } from '@novakai/canvas-service';
import type { Admission } from '@novakai/canvas-templates';
import type { Collection } from '@novakai/canvas-model';
import type { Span } from '@novakai/canvas-language';
/**
 * Model's collection, and Model's own `Result`. `ModelResult` has the same `ok`, `value` and
 * `error` fields as the CLI's `Result`; its error holds Model's findings.
 */
export type { Collection, Result as ModelResult } from '@novakai/canvas-model';
/**
 * Language, which reads `.canvas` text: its own `Result`, the parsed text, one font or image a
 * source declares, what a source's font, image and theme names stand for, and a place in the text.
 */
export type {
  Language,
  Result as LanguageResult,
  ParsedSource,
  ResolvedResources,
  ResourceRequest,
  Span,
} from '@novakai/canvas-language';
/** Language's profile records: what a profile asks for, a starter's ID and title, lint findings. */
export type {
  ProfileDescriptor,
  ProfileFinding,
  ProfileLintResult,
  ProfileStarter,
} from '@novakai/canvas-language';
/** The service's laid-out drawing of a collection, and its report on that drawing. */
export type { InspectionReport, RenderDocument } from '@novakai/canvas-service';
/**
 * Assets, the store of font and image bytes: the store, bytes to store, bytes read back, and the
 * file types it accepts.
 */
export type { Assets, StageInput, StoredBlob, SupportedMedia } from '@novakai/canvas-assets';
/**
 * Templates' saved themes and recipes ("presets"): one to save, the list the service knows, a
 * recipe to copy out as source (with its namespace), and one theme in that list.
 */
export type { Admission, Catalog, ExpansionRequest, ThemePreset } from '@novakai/canvas-templates';
/** Templates' `.theme` records: what a theme file declares, its fonts, and why one was refused. */
export type {
  FontRequest,
  FontRole,
  ThemeAdmission,
  ThemeSource,
  ThemeSourceCode,
  ThemeSourceFailure,
} from '@novakai/canvas-templates';
/**
 * Export, which turns a drawing into image bytes: its findings, how it reads collections, the fonts
 * and images it may use, and the collection frozen at one revision for it to draw.
 */
export type {
  Diagnostic as ExportDiagnostic,
  Documents,
  Resource,
  Resources,
  Snapshot as ExportSnapshot,
} from '@novakai/canvas-export';
/**
 * Authoring's records: every saved record in a workspace, a change request, its receipt, the
 * version a change expects a record to be at, and one saved record.
 */
export type {
  Snapshot as WorkspaceSnapshot,
  Request as AuthoringRequest,
  Receipt,
  ReadVersion,
  StoredRecord,
} from '@novakai/canvas-authoring';
/** The service's HTTP answer: its generation, and the outcome. */
export type { TransportResponse } from '@novakai/canvas-service';

/**
 * A failure record as the service writes it: its code, message, what to do next, and any evidence.
 * Taken from the service's own answer type, never copied.
 */
export type ServiceFailureRecord = Extract<
  TransportResponse['outcome'],
  { readonly ok: false }
>['error'];

/** Why another part refused, kept whole: Language's or Model's findings, or a service failure. */
export type FailureSource = NonNullable<ServiceFailureRecord['source']>;

/** One font or image a collection declares, as Model types it. */
export type CollectionAsset = Collection['assets'][number];

/** A point in a source file: offset, line and column (from 1). */
export type SourcePosition = Span['start'];

/** A recipe's diagram family, such as `er` or `sequence`, as Templates declares it. */
export type RecipeFamily = Extract<Admission, { readonly kind: 'recipe' }>['family'];

/**
 * The service's tools for drawing a diagram without a browser: theme preparation, render jobs and
 * the diagram producer. Taken from the function that makes them.
 */
export type HeadlessTools = Awaited<ReturnType<typeof createHeadlessBindings>>;
