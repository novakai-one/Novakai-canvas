import { requestId } from '../../contract/brands.js';
import type { Digest, WorkspaceId } from '../../contract/brands.js';
import type { Dependencies } from '../../contract/types.js';
import type {
  Snapshot,
  Receipt,
  CommitOutcome,
  ReadVersion,
} from '../../contract/records/storage.js';
import type { HistoryStatus } from '../../contract/records/history.js';
import type { CommitRequest } from '../../contract/ports/store.js';
import { navigationKey, historyStatus, readNavigation } from './navigation.js';
import { boundNavigation, staleHistory } from './retention.js';
import { findRecord, versionOf } from '../records/keys.js';
import { readSnapshot, readReceipt } from '../validation/snapshot.js';
import { copyJson, storedLimits } from '../validation/plain-data.js';
import { accepted, reject } from '../validation/outcomes.js';

/** The kinds of history-only commit that opening a workspace can make. */
type HistoryCommitKind = 'history-adoption' | 'history-compaction';

/** The fixed request ID of the one-time commit that adds history to a workspace. */
const migrationId = requestId.parse('history-adoption-v1');

/**
 * Makes sure a workspace has history navigation, and returns its undo/redo status.
 *
 * Runs when a workspace is opened; it is the only code that writes the first navigation record.
 * - A workspace without navigation is adopted: one commit stores a baseline navigation that
 *   lists every existing content record. Concurrent adoptions are safe; only one commits.
 * - A workspace with navigation is checked, and history over the limits (left by older builds)
 *   is trimmed. Trimming failures never stop the workspace opening; the next write trims instead.
 *
 * Content records are never rewritten here.
 *
 * @param workspace - The workspace to open.
 * @param deps - Authoring's collaborators.
 * @returns The workspace's undo/redo status.
 * @throws AuthoringFault with a collaborator's own diagnostic when reading or committing fails.
 * @throws AuthoringFault `corrupt-record` when the adoption receipt and navigation disagree, or history is corrupt.
 */
export async function initializeHistory(
  workspace: WorkspaceId,
  deps: Dependencies,
): Promise<HistoryStatus> {
  const adoptionReceipt = accepted(await deps.receipts.find(workspace, migrationId));
  const storedSnapshot = accepted(await deps.snapshots.read(workspace));
  const snapshot = readSnapshot(storedSnapshot, workspace);

  const navigationRecord = findRecord(snapshot, navigationKey);
  if (navigationRecord !== null) return reopenedAndTrimmed(snapshot, deps);

  if (adoptionReceipt !== null)
    reject('corrupt-record', 'history', 'Adoption receipt exists without navigation');
  return adopt(snapshot, deps);
}

/** Checks an already adopted workspace, then trims its history when it is over the limits. */
async function reopenedAndTrimmed(
  snapshot: Snapshot,
  deps: Dependencies,
): Promise<HistoryStatus> {
  const adoptionReceipt = accepted(await deps.receipts.find(snapshot.workspace, migrationId));
  const status = reopened(snapshot, adoptionReceipt, deps);

  const commit = compaction(snapshot, deps);
  if (commit === null) return status;

  const trimmed = await settled(commit, deps);
  if (trimmed) return initializeHistory(snapshot.workspace, deps);
  return status;
}

/**
 * Checks the adoption receipt, when one is still stored, and returns the history status.
 * The receipt may be missing because the receipt log is bounded.
 */
function reopened(
  snapshot: Snapshot,
  receipt: Receipt | null,
  deps: Dependencies,
): HistoryStatus {
  if (receipt === null) return historyStatus(snapshot);

  readReceipt(receipt, migrationId);
  if (receipt.fingerprint !== adoptionFingerprint(snapshot, deps))
    reject('corrupt-record', 'history', 'Adoption receipt identity differs');

  const status = historyStatus(snapshot);
  checkAdoptionReceipt(receipt);
  return status;
}

/**
 * Rejects an adoption receipt that does not list the navigation record among its versions.
 * Each key's `kind` is read first; its `id` is read only when the kind is `history`.
 */
function checkAdoptionReceipt(receipt: Receipt): void {
  const listsNavigation = receipt.versions.some(
    (read) => read.key.kind === 'history' && read.key.id === 'navigation',
  );
  if (!listsNavigation)
    reject('corrupt-record', 'history', 'Adoption receipt does not identify navigation');
}

/**
 * Commits the baseline navigation, then opens the workspace again.
 * The commit expects every existing record at its current version and a unique receipt, so
 * concurrent adoptions cannot both succeed.
 */
async function adopt(
  snapshot: Snapshot,
  deps: Dependencies,
): Promise<HistoryStatus> {
  const frontier = snapshot.records
    .filter((record) => record.key.kind !== 'history')
    .map((record) => versionOf(snapshot, record.key));
  const fingerprint = adoptionFingerprint(snapshot, deps);
  const outcome = committedOutcome('history-adoption');
  const expected: ReadVersion[] = [
    ...snapshot.records.map((record) => versionOf(snapshot, record.key)),
    versionOf(snapshot, navigationKey),
  ];
  const baselineNavigation = {
    schemaVersion: 1,
    baselineSequence: snapshot.sequence,
    actions: [],
    cursor: 0,
    frontier,
  };
  const commit: CommitRequest = {
    workspace: snapshot.workspace,
    request: migrationId,
    fingerprint,
    expected,
    writes: [
      {
        kind: 'put',
        key: navigationKey,
        resources: [],
        value: copyJson(baselineNavigation, storedLimits),
      },
    ],
    outcome,
  };
  await commitHistoryChange(commit, deps);
  return initializeHistory(snapshot.workspace, deps);
}

/**
 * Builds the commit that trims history to the limits and purges unreachable history records.
 * Returns `null` when history is already within the limits and nothing is stale.
 */
function compaction(
  snapshot: Snapshot,
  deps: Dependencies,
): CommitRequest | null {
  const history = readNavigation(snapshot);
  const bounded = boundNavigation(snapshot, history);
  const purges = staleHistory(snapshot, bounded.actions, []);
  if (bounded === history && purges.length === 0) return null;

  const compactionId = `history-compaction-${snapshot.sequence}`;
  const navigation = copyJson(bounded, storedLimits);
  const writes: CommitRequest['writes'] = [
    { kind: 'put', key: navigationKey, resources: [], value: navigation },
    ...purges,
  ];
  return {
    workspace: snapshot.workspace,
    request: requestId.parse(compactionId),
    fingerprint: accepted(deps.hash.digest(`${compactionId}:${snapshot.workspace}`)),
    expected: writes.map((write) => versionOf(snapshot, write.key)),
    writes,
    outcome: committedOutcome('history-compaction'),
  };
}

/** Commits a history-only change, treating a lost acknowledgement as success when its receipt is stored. */
async function commitHistoryChange(
  commit: CommitRequest,
  deps: Dependencies,
): Promise<void> {
  try {
    accepted(await deps.commits.commit(commit));
  } catch (error) {
    await reconcileHistoryCommit(commit, deps, error);
  }
}

/**
 * After a failed history commit, succeeds when the commit's receipt is stored, otherwise rethrows.
 * A stored receipt with a different fingerprint means another request used the same ID.
 */
async function reconcileHistoryCommit(
  commit: CommitRequest,
  deps: Dependencies,
  error: unknown,
): Promise<void> {
  const storedReceipt = accepted(await deps.receipts.find(commit.workspace, commit.request));
  if (storedReceipt === null) throw error;
  if (storedReceipt.fingerprint !== commit.fingerprint)
    reject('corrupt-record', 'history', 'History request identity collision');
}

/** Tries a trimming commit. Returns `false` instead of failing, so opening never fails over trimming. */
async function settled(
  commit: CommitRequest,
  deps: Dependencies,
): Promise<boolean> {
  try {
    await commitHistoryChange(commit, deps);
    return true;
  } catch {
    return false;
  }
}

/** Hashes the fixed adoption identity of a workspace. */
function adoptionFingerprint(
  snapshot: Snapshot,
  deps: Dependencies,
): Digest {
  return accepted(deps.hash.digest(`history-adoption-v1:${snapshot.workspace}`));
}

/** The outcome stored with a history-only commit. It has no transaction and no pins. */
function committedOutcome(kind: HistoryCommitKind): CommitOutcome {
  return {
    status: 'committed',
    transaction: null,
    pins: null,
    diff: { kind },
    warnings: [],
  };
}
