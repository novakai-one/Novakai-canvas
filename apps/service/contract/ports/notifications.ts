/*
 * Why this file exists
 *
 * When someone saves a change, every open browser tab should find out, so it can show the new
 * diagram. Authoring announces each saved change. The HTTP change stream (`GET /api/v1/events`)
 * passes it on to the browsers.
 *
 * This file declares the channel between them: `CommittedChange` (what was saved) and
 * `ChangeChannel` (announce, listen, close). A change is only a hint: a listener reads the
 * workspace again to see what changed, and keeps its own unsaved drafts.
 */
import type { Notifications, Receipt } from '../records/capability-types.js';
import type { WorkspaceId } from '../brands.js';
/** One saved change: which workspace, and the receipt Authoring wrote for it. */
export interface CommittedChange {
  readonly workspace: WorkspaceId;
  readonly receipt: Receipt;
}
/**
 * The channel saved changes travel through. Authoring announces each one (the `Notifications` part
 * it extends); listeners hear about it.
 */
export interface ChangeChannel extends Notifications {
  /** Calls `listener` after every saved change. Returns the function that stops listening. */
  subscribe(listener: (change: CommittedChange) => void): () => void;
  /** Removes every listener. The session calls it when it closes. */
  close(): void;
}
