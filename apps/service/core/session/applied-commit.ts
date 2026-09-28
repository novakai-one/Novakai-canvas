/*
 * Why this file exists
 *
 * After a change is saved, the caller wants to see the new workspace without a second request.
 * For example, `POST /api/v1/authoring/apply` answers the save's receipt and the workspace right
 * after it, in one answer.
 *
 * This file saves the change through Authoring, then reads the workspace back. If only the read
 * fails, the change is still saved, and the caller can look up its receipt later. It never decides
 * whether a change may be saved; Authoring does.
 */
import type {
  Authoring,
  AuthoringResult,
  Request,
} from '../../contract/records/capability-types.js';
import type { AppliedCommit } from '../../contract/records/workspace/session.js';
import { authoringFailure } from '../../contract/errors.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { stripHistoryContents } from './history-versions.js';

/**
 * Saves a change through Authoring, then reads the workspace back without its history contents.
 * `options` are the apply options as sent; Authoring checks them. A refused change answers
 * Authoring's failure. A failed read-back answers `storage-unavailable` at `snapshot`, yet the
 * change stays saved.
 */
export async function commitThenRead(
  authoring: Authoring,
  workspace: WorkspaceId,
  request: Request,
  options: unknown,
): Promise<AuthoringResult<AppliedCommit>> {
  const committed = await authoring.apply(request, options);
  if (!committed.ok) return committed;
  const committedWorkspace = await authoring.read(workspace);
  if (!committedWorkspace.ok) return carriedSnapshotUnread();
  return {
    ok: true,
    value: { receipt: committed.value, snapshot: stripHistoryContents(committedWorkspace.value) },
  };
}

/** A committed edit is never a refusal: a failed snapshot read leaves the receipt durable and the fate uncertain, so the client reconciles the receipt instead of dropping the write. */
function carriedSnapshotUnread(): AuthoringResult<never> {
  return authoringFailure(
    'storage-unavailable',
    'snapshot',
    'The edit committed, but the new workspace could not be read',
  );
}
