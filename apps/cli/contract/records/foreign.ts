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
/** Model's records. */
export type {
  Collection, // One checked collection: its sections, objects, wires, theme, fonts and images.
  Result as ModelResult, // Model's own `Result`: `ok`, `value`, `error` (Model's findings).
} from '@novakai/canvas-model';
/** Language, which reads and prints `.canvas` text. */
export type {
  Language, // Language itself: it parses and prints text, and turns text into a collection.
  Result as LanguageResult, // Language's own `Result`: `ok`, `value`, `error` (its findings).
  ParsedSource, // A source after parsing, before it becomes a collection.
  ResolvedResources, // The theme, font and image records a source's names stand for.
  ResourceRequest, // One theme, font or image a source names, before it is looked up.
  Span, // Where something sits in the text: its start and end.
} from '@novakai/canvas-language';
/** Language's profiles. A profile is a set of rules a collection follows. */
export type {
  ProfileDescriptor, // What a profile asks for: the parts a source needs, its rules and notes.
  ProfileFinding, // One broken rule that `profile lint` found, and where.
  ProfileLintResult, // `profile lint`'s outcome: `passed`, `failed` or `unsupported-source`.
  ProfileStarter, // The collection ID and title `profile scaffold` starts from.
} from '@novakai/canvas-language';
/** The service's drawing records. */
export type {
  InspectionReport, // The service's report on a laid-out drawing, such as wires that cross.
  RenderDocument, // A collection laid out: where each box and wire goes.
} from '@novakai/canvas-service';
/** Assets, the store of font and image bytes. */
export type {
  Assets, // The store itself.
  StageInput, // Bytes to store, and their file type.
  StoredBlob, // Stored bytes read back, with their digest.
  SupportedMedia, // A file type the store accepts, such as `image/png`.
} from '@novakai/canvas-assets';
/** Templates' saved themes and recipes, which it calls presets. */
export type {
  Admission, // One theme or recipe to save.
  Catalog, // A list of presets, such as every theme and recipe a render knows.
  ExpansionRequest, // Which recipe to copy out (ID, version, digest) and the new collection's ID.
  ThemePreset, // One theme in the catalog.
} from '@novakai/canvas-templates';
/** Templates' records for a `.theme` file. */
export type {
  FontRequest, // One `font` line: the font's role and its file path.
  FontRole, // A theme font's role: `body`, `mono` or `strong`.
  ThemeAdmission, // The theme a `.theme` file declares, ready to save.
  ThemeSource, // A read `.theme` file: its theme to save and its three fonts.
  ThemeSourceCode, // Why a `.theme` file was refused: `invalid-theme` or `duplicate-token`.
  ThemeSourceFailure, // That refusal, with its message and what to fix.
} from '@novakai/canvas-templates';
/** Export, which turns a drawing into image bytes. */
export type {
  Diagnostic as ExportDiagnostic, // Export's failure record.
  Documents, // How Export reads, prints and parses a collection (via Model and Language).
  Resource, // One file's bytes handed to Export (a font, an image or a preset), with its digest.
  Resources, // The check Export runs on those files before using them.
  Snapshot as ExportSnapshot, // The collection at the revision being drawn, for Export.
} from '@novakai/canvas-export';
/** Authoring's records. */
export type {
  Snapshot as WorkspaceSnapshot, // Every saved record in a workspace, read at one moment.
  Request as AuthoringRequest, // A change request, as Authoring checks it.
  Receipt, // Authoring's proof that a request was saved.
  ReadVersion, // A record's key, and the version a change expects it at (or `absent`).
  StoredRecord, // One saved record.
} from '@novakai/canvas-authoring';
/**
 * The service's HTTP answer: the generation of the service that sent it (the label of one service
 * start; see `brands.ts`), and the outcome.
 */
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
