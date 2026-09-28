/*
 * The storage seams: the conditional storage adapters/storage wraps, and the three Authoring
 * storage roles it exposes. Declarations only; Persistence owns its failures, Authoring owns
 * commit and receipt recovery.
 */
import type { SnapshotReader, ReceiptReader, Committer } from '../records/capabilities.js';
import type { Result, WorkspaceState, Receipt } from '@novakai/canvas-persistence';
/** Consumer-owned physical role: the Authoring bridge does not receive maintenance or lifecycle authority. */
export interface ConditionalStorage {
  readSnapshot(): Result<WorkspaceState>;
  receipt(request: unknown): Result<Receipt | null>;
  commit(request: unknown): Result<Receipt>;
}
/** The host bridge exposes Authoring's three storage roles; arbitrary web/CLI record writes are never public service operations. */
export interface AuthoringStore {
  readonly snapshots: SnapshotReader;
  readonly receipts: ReceiptReader;
  readonly commits: Committer;
}
