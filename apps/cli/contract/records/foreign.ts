/*
 * Why this file exists
 *
 * The CLI works with records other parts own. A `read` answer is about Model's `Collection`, and
 * a refused change carries the service's failure record. Copying those shapes would let them drift
 * apart from their owners.
 *
 * This file passes those types on from their owners, so CLI core finds them in one place and
 * never imports a capability package. Where an owner names no type, it takes one from the owner's
 * own, such as `SourcePosition` from Language's `Span`. It declares types only.
 */
import type { TransportResponse, createHeadlessBindings } from '@novakai/canvas-service';
import type { Admission } from '@novakai/canvas-templates';
import type { Collection } from '@novakai/canvas-model';
import type { Span } from '@novakai/canvas-language';
export type { Collection, Mode, Result as ModelResult } from '@novakai/canvas-model';
export type {
  Declaration,
  Language,
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
export type { InspectionReport, RenderDocument } from '@novakai/canvas-service';
export type { Assets, StageInput, StoredBlob, SupportedMedia } from '@novakai/canvas-assets';
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
export type {
  Diagnostic as ExportDiagnostic,
  Documents,
  Resource,
  Resources,
  Snapshot as ExportSnapshot,
} from '@novakai/canvas-export';
/** Authoring's records: a workspace snapshot, a change request, its receipt, and a saved record. */
export type {
  Snapshot,
  Request,
  Receipt,
  RecordKey,
  ReadVersion,
  StoredRecord,
} from '@novakai/canvas-authoring';
export type { TransportResponse } from '@novakai/canvas-service';

/**
 * A failure as the service writes it: its code, message, what to do next, and any evidence. Taken
 * from the service's own answer type, never copied.
 */
export type OperationSource = Extract<
  TransportResponse['outcome'],
  { readonly ok: false }
>['error'];

/** Why another part refused, kept whole: Language's or Model's findings, or a service failure. */
export type FailureSource = NonNullable<OperationSource['source']>;

/** One font or image a collection declares, as Model types it. Model names no type for it. */
export type CollectionAsset = Collection['assets'][number];

/** A point in a source file: offset, line and column (from 1). Language names no type for it. */
export type SourcePosition = Span['start'];

/** A recipe's diagram family, such as `er` or `sequence`, as Templates declares it. */
export type RecipeFamily = Extract<Admission, { readonly kind: 'recipe' }>['family'];

/**
 * The service's tools for drawing a diagram without a browser: theme preparation, render jobs and
 * the diagram producer. The service names no type for them yet, so this is taken from its factory.
 */
export type HeadlessBindings = Awaited<ReturnType<typeof createHeadlessBindings>>;
