/**
 * The public surface of Authoring.
 *
 * - `createAuthoring` and `composeAuthoring` build the facade, the only way to change a workspace.
 * - The rest are data contracts, ID brands and the collaborator roles (ports) that hosts implement.
 *
 * Internal policy helpers are not exported.
 */

// Facade.
export { createAuthoring } from './api.js';
export { composeAuthoring } from './compose.js';

// Checked ID brands.
export {
  workspaceId,
  recordId,
  requestId,
  actorId,
  plannerId,
  digest,
  timestamp,
} from './brands.js';
export type {
  WorkspaceId,
  RecordId,
  RequestId,
  ActorId,
  PlannerId,
  Digest,
  Timestamp,
} from './brands.js';

// Results and failures.
export { failure } from './errors.js';
export type { Diagnostic, ErrorCode, Result } from './errors.js';

// Facade and collaborator types.
export type { Authoring, Dependencies } from './types.js';

// Data records.
export type {
  Json,
  RecordKey,
  ReadVersion,
  StoredRecord,
  Snapshot,
  Write,
  Receipt,
  CommitOutcome,
} from './records/storage.js';
export type { Request, Intent, ApplyOptions } from './records/request.js';
export type { Preparation, Proposal, FeasibilityReport } from './records/proposal.js';
export type {
  Transaction,
  HistoryHead,
  HistoryStatus,
  HistoryAction,
  HistoryNavigation,
} from './records/history.js';
export { historyStatusSchema } from './records/history.js';

// Collaborator roles (ports).
export type { SnapshotReader, ReceiptReader, Committer, CommitRequest } from './ports/store.js';
export type { IntentPlanner, CandidateValidator, Feasibility } from './ports/planning.js';
export type { ResourceAdmission, ResourceLease } from './ports/resources.js';
export type { Hasher, Clock, Cancellation, Notifications } from './ports/runtime.js';

// Checked interchange schemas for host bridges. Admission still re-checks every collaborator result.
export { snapshotSchema, receiptSchema } from './records/storage.js';
export { requestSchema } from './records/request.js';
export { proposalSchema } from './records/proposal.js';
