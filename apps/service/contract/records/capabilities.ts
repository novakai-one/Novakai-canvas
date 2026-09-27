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
  SnapshotReader,
  ReceiptReader,
  Committer,
  CommitRequest,
  IntentPlanner,
  CandidateValidator,
  Feasibility,
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
export type { Language, ResolvedResources } from '@novakai/canvas-language';
export type { Organisation, LibrarySnapshot } from '@novakai/canvas-library';
