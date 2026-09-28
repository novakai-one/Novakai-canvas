/**
 * Persistence's public surface: atomic versioned storage, receipts, and backup/restore for one
 * workspace.
 *
 * Only trusted composition (Authoring, and the maintenance host for backup/restore) should open
 * it. Start with `openSqlite`; `createPersistence` binds any StorePort. Everything else here is
 * a type or a checking schema.
 */
export { openSqlite } from './compose.js';
export { createPersistence } from './api.js';
export { workspaceId, recordId, requestId, digest } from './brands.js';
export type { WorkspaceId, RecordId, RequestId, Digest } from './brands.js';
export type { Result, StorageError, ErrorCode } from './errors.js';
export type { Persistence } from './types.js';
export type {
  WorkspaceState,
  RecordKey,
  ReadVersion,
  Slot,
  Receipt,
  Json,
} from './records/storage.js';
export type { CommitRequest, Write } from './records/transaction.js';
export type { BackupBundle, BlobRecord } from './records/backup.js';
export type { StorePort, Decision } from './ports/store.js';
export type { DatabasePort } from './ports/database.js';
export type {
  BackupResources,
  RestoreResources,
  ResourceLease,
  RestoreLease,
  VerifyBlob,
  ValidateDomain,
} from './ports/resources.js';
