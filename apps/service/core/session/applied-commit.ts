/*
 * Apply's answer: commit through Authoring, then read the post-commit workspace. Pure over the
 * injected Authoring. Authoring owns commit and receipt recovery; a failed read leaves the commit
 * standing and the client reconciles through the receipt lookup.
 */
import type { Authoring, AuthoringResult } from '../../contract/records/capabilities.js';
import type { AppliedCommit } from '../../contract/records/workspace/session.js';
import { authoringFailure } from '../../contract/errors.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { historyVersionsOnly } from './history-versions.js';

/**
 * Commit, then read the post-commit workspace from the same owner, with history contents stripped as the
 * workspace route strips them. A refused commit passes Authoring's failure through unchanged. A failed
 * read after the commit is `storage-unavailable` (path `snapshot`), yet the commit stands: its receipt
 * is durable and the client reconciles through the receipt lookup.
 */
export async function commitThenRead(
  authoring: Authoring,
  workspace: WorkspaceId,
  request: unknown,
  options: unknown,
): Promise<AuthoringResult<AppliedCommit>> {
  const committed = await authoring.apply(request, options);
  if (!committed.ok) return committed;
  const committedWorkspace = await authoring.read(workspace);
  if (!committedWorkspace.ok) return carriedSnapshotUnread();
  return {
    ok: true,
    value: { receipt: committed.value, snapshot: historyVersionsOnly(committedWorkspace.value) },
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
