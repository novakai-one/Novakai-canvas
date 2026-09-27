/*
 * Foreign vocabulary: the capability and service records the CLI speaks in. Type-only re-exports
 * keep CLI core, contract ports and the render factories inside every capability's public entry.
 */
import type { TransportResponse, createHeadlessBindings } from '@novakai/canvas-service';
import type { Admission } from '@novakai/canvas-templates';
export type { Collection, Mode, Result as ModelResult } from '@novakai/canvas-model';
export type {
  Declaration,
  Language,
  ParsedSource,
  ResolvedResources,
  ResourceRequest,
  Span,
} from '@novakai/canvas-language';
export type { InspectionReport, RenderDocument } from '@novakai/canvas-service';
export type { Assets, StageInput, SupportedMedia } from '@novakai/canvas-assets';
export type { Admission, Catalog, ExpansionRequest, ThemePreset } from '@novakai/canvas-templates';
export type { Documents, Resource, Resources } from '@novakai/canvas-export';
/** Owner records: CLI core imports only these local aliases. */
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
 * A failure record as the service writes it: code, path, message, recovery and any nested
 * evidence. Derived from the service's transport envelope, never copied. The agent credential
 * reader fails with the same shape.
 */
export type OperationSource = Extract<
  TransportResponse['outcome'],
  { readonly ok: false }
>['error'];

/** Evidence under a failure: Language or Model validation diagnostics, or a nested operation failure. */
export type FailureSource = NonNullable<OperationSource['source']>;

/** A recipe's diagram family, as Templates' admission declares it. */
export type RecipeFamily = Extract<Admission, { readonly kind: 'recipe' }>['family'];

/**
 * The service's headless render bindings: theme preparation, preset codecs, render jobs and the
 * diagram producer. The service declares no type for them yet, so this is derived from its factory.
 */
export type HeadlessBindings = Awaited<ReturnType<typeof createHeadlessBindings>>;
