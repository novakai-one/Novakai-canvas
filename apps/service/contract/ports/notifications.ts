/*
 * The committed-change seam: Authoring publishes each commit, and the HTTP event stream
 * subscribes. Declarations only; adapters/notifications implements it. A change is a hint:
 * subscribers reread the snapshot.
 */
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
