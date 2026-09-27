/*
 * The capability vocabulary service core reads through the contract: type-only aliases of each
 * capability's public types, so core never imports a capability package. Declarations only; each
 * capability owns its own failures, and Authoring owns commit and recovery.
 */
export type {
  Authoring,
  Snapshot,
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
  WorkspaceId,
  PlannerId,
  Digest,
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
  StoredBlob,
} from '@novakai/canvas-assets';
export type {
  FontSource,
  VisualAsset,
  ReactBindings as PresentationBindings,
} from '@novakai/canvas-presentation';
export type { Scene } from '@novakai/canvas-layout';
export type { Organisation, LibrarySnapshot } from '@novakai/canvas-library';
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
