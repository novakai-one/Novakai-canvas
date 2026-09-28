/*
 * Why this file exists
 *
 * Service core uses capability types everywhere: Authoring's `Request` and `Receipt`, Model's
 * `Collection`, Templates' `Catalog`, and more. But core may not import a capability package.
 *
 * So this file passes those types through, as types only, and core imports them from here. Where
 * two capabilities use the same name, the type is renamed after its owner. For example, Authoring's
 * `Result` is `AuthoringResult` and Export's `Snapshot` is `ExportSnapshot`.
 *
 * Declarations only. Each capability keeps its own mistakes; Authoring decides whether a change is
 * saved.
 */
export type {
  Authoring,
  Snapshot,
  HistoryStatus,
  StoredRecord,
  RecordKey,
  ReadVersion,
  Request,
  Receipt,
  Proposal,
  Result as AuthoringResult,
  Diagnostic as AuthoringDiagnostic,
  ErrorCode as AuthoringErrorCode,
  SnapshotReader,
  ReceiptReader,
  Committer,
  IntentPlanner,
  CandidateValidator,
  Feasibility,
  FeasibilityReport,
  ResourceAdmission,
  ResourceLease,
  Cancellation,
  Notifications,
  Json,
} from '@novakai/canvas-authoring';
export type { Collection, Change } from '@novakai/canvas-model';
export type {
  Language,
  LoweredIntent,
  ResolvedResources,
  ResourceRequest,
  Scope,
  Result as LanguageResult,
  ValidationError as LanguageError,
} from '@novakai/canvas-language';
export type {
  Templates,
  Catalog,
  Preset,
  ThemePreset,
  RecipePayload,
  ThemePayload,
  Pin as PresetPin,
  Result as TemplatesResult,
  ErrorCode as TemplatesErrorCode,
} from '@novakai/canvas-templates';
export type {
  DesignSystem,
  PortableTheme,
  PortableToken,
  ChromeName,
} from '@novakai/canvas-design-system';
export type {
  Admission,
  Assets,
  WriteLease,
  ReadLease,
  Result as AssetResult,
  ErrorCode as AssetErrorCode,
  StoredBlob,
} from '@novakai/canvas-assets';
export type {
  FontSource,
  VisualAsset,
  ReactBindings as PresentationBindings,
} from '@novakai/canvas-presentation';
export type { Scene, Warning as SceneWarning } from '@novakai/canvas-layout';
export type {
  Organisation,
  LibrarySnapshot,
  CollectionProjection,
  SectionProjection,
  ObjectProjection,
} from '@novakai/canvas-library';
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
  SnapshotReader as ExportSnapshotReader,
} from '@novakai/canvas-export';
