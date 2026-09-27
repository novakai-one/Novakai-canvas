/** Public capability vocabularies are consumed through declaration-only aliases; host core never reaches private owners. */
export type {
  Authoring,
  Snapshot,
  StoredRecord,
  RecordKey,
  ReadVersion,
  Write,
  Request,
  Receipt,
  Proposal,
  Result as AuthoringResult,
  Diagnostic as AuthoringDiagnostic,
  ErrorCode as AuthoringErrorCode,
  SnapshotReader,
  ReceiptReader,
  Committer,
  CommitRequest,
  IntentPlanner,
  CandidateValidator,
  Feasibility,
  FeasibilityReport,
  ResourceAdmission,
  ResourceLease,
  Cancellation,
  Notifications,
  WorkspaceId,
  Digest,
  Json,
} from '@novakai/canvas-authoring';
export type { Collection, Change, ChangePlan } from '@novakai/canvas-model';
export type { Persistence } from '@novakai/canvas-persistence';
export type {
  Language,
  LoweredIntent,
  ResolvedResources,
  ResourceRequest,
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
  Result as TemplatesResult,
} from '@novakai/canvas-templates';
export type {
  DesignSystem,
  PortableTheme,
  PortableToken,
  ChromeName,
} from '@novakai/canvas-design-system';
export type { Assets, WriteLease } from '@novakai/canvas-assets';
export type { Organisation, LibrarySnapshot } from '@novakai/canvas-library';
