import type { Notifications, Receipt, WorkspaceId } from '../records/capabilities.js';
/** Change messages are hints only; subscribers reread authoritative snapshots and preserve their local drafts. */
export interface CommittedChange {
  readonly workspace: WorkspaceId;
  readonly receipt: Receipt;
}
export interface ChangeChannel extends Notifications {
  subscribe(listener: (change: CommittedChange) => void): () => void;
  close(): void;
}
