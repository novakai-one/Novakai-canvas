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
import { authoringFailure, success } from '../../contract/errors.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { stripHistoryContents } from './history-versions.js';

/**
 * Saves `change` through Authoring, then reads the workspace back without its history contents.
 * `change` is the Authoring request to save (not the HTTP request); `options` are the apply
 * options as sent. Authoring checks both. A refused change answers Authoring's failure. If only the
 * read-back fails, it answers `storage-unavailable`, but the change stays saved.
 */
export async function commitThenRead(
  authoring: Authoring,
  workspace: WorkspaceId,
  change: Request,
  options: unknown,
): Promise<AuthoringResult<AppliedCommit>> {
  const receipt = await authoring.apply(change, options);
  if (!receipt.ok) {
    return receipt;
  }
  const savedWorkspace = await authoring.read(workspace);
  if (!savedWorkspace.ok) {
    return readBackFailure();
  }
  const snapshot = stripHistoryContents(savedWorkspace.value);
  return success({ receipt: receipt.value, snapshot });
}

/**
 * Makes the mistake for a saved change whose new workspace could not be read
 * (`storage-unavailable` at `snapshot`); the change stays saved, and its receipt can be looked up.
 */
function readBackFailure(): AuthoringResult<never> {
  return authoringFailure(
    'storage-unavailable',
    'snapshot',
    'The edit committed, but the new workspace could not be read',
  );
}
