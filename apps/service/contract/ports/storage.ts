/*
 * Why this file exists
 *
 * Authoring saves every change, but it doesn't know about SQLite. It asks for three things: read
 * the workspace, find a request's receipt, commit a change. Persistence stores the data in its own
 * terms, and commits only if nothing changed since the caller read it (a "conditional" commit).
 *
 * This file declares both sides: `ConditionalStorage` (the part of Persistence the service uses)
 * and `AuthoringStore` (the three roles Authoring is given). adapters/storage joins them.
 * Declarations only. Neither the web app nor the CLI can write a record except through Authoring.
 */
import type { SnapshotReader, ReceiptReader, Committer } from '../records/capability-types.js';
import type { Result as StorageResult, WorkspaceState, Receipt } from '@novakai/canvas-persistence';
/**
 * The part of Persistence the service uses: read, find a receipt, commit. It can't delete, back up
 * or close the database; compose keeps those.
 */
export interface ConditionalStorage {
  /** Reads everything stored for the workspace, with each record's version. */
  readSnapshot(): StorageResult<WorkspaceState>;
  /**
   * Finds the receipt of a saved request, or `null`. `requestId` is Authoring's; Persistence checks
   * it.
   */
  receipt(requestId: unknown): StorageResult<Receipt | null>;
  /**
   * Commits Authoring's commit request if every version it read is still current. Persistence
   * checks the request.
   */
  commit(request: unknown): StorageResult<Receipt>;
}
/** The three storage roles Authoring is given: read the workspace, find a receipt, commit. */
export interface AuthoringStore {
  readonly snapshots: SnapshotReader;
  readonly receipts: ReceiptReader;
  readonly commits: Committer;
}
