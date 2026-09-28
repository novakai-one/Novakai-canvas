import type { Request } from '../../contract/records/request.js';
import type { Proposal } from '../../contract/records/proposal.js';
import type {
  Snapshot,
  Write,
  StoredRecord,
  RecordKey,
  ReadVersion,
} from '../../contract/records/storage.js';
import type { HistoryHead, Transaction } from '../../contract/records/history.js';
import { readTransaction, readHead, transactionKey, headKey } from './read.js';
import { compareVersions } from '../records/versions.js';
import { findRecord, keyText, versionOf } from '../records/keys.js';
import {
  readNavigation,
  nextAction,
  navigationKey,
  checkParticipantCoverage,
} from './navigation.js';
import type { Direction } from './navigation.js';
import { reject } from '../validation/outcomes.js';

/** One record's change inside a stored transaction. */
type Transition = Transaction['transitions'][number];

/**
 * Plans the writes for an undo or redo from Authoring's own history.
 *
 * Checks, in order:
 * 1. The intent is an undo or redo.
 * 2. The original change's transaction and head are stored and well-formed.
 * 3. Every retained before/after image belongs to its record.
 * 4. The head lists exactly the transaction's records.
 * 5. The change is in the right state (active for undo, undone for redo), and it is the next
 *    step in navigation. For workspaces without navigation, the records must be unchanged instead.
 *
 * The result is ordinary proposal data. It goes through the same candidate, resource and
 * feasibility checks as any planner's proposal.
 *
 * @param request - The checked undo or redo request.
 * @param snapshot - The current workspace snapshot.
 * @returns Writes that restore each record's before image (undo) or after image (redo).
 * @throws AuthoringFault `invalid-input` when the intent is a change, the request lacks the navigation version,
 *   the transaction or head repeats a record key, or the original transaction is itself an undo or redo.
 * @throws AuthoringFault `unknown-reference` when the original change's history is missing.
 * @throws AuthoringFault `corrupt-record` when stored history is malformed, has a foreign image, or its
 *   head and transaction name different records.
 * @throws AuthoringFault `revision-conflict` when the change is in the wrong state, is not the next step,
 *   or a record it touched has changed.
 */
export function planInverse(
  request: Request,
  snapshot: Snapshot,
): Proposal {
  if (request.intent.kind === 'change')
    return reject('invalid-input', 'intent', 'An inverse intent is required');

  const direction = request.intent.kind;
  const original = request.intent.transaction;
  const transaction = readTransaction(snapshot, original);
  const head = readHead(snapshot, original);
  transaction.transitions.forEach((transition) => checkTransitionIdentity(transition));
  checkParticipantCoverage(transaction, head);
  checkHead(snapshot, request, head);

  const writes = transaction.transitions.map((transition) =>
    restoreRecord(transition, imageToRestore(transition, direction)),
  );
  const reads: readonly ReadVersion[] = [
    ...head.participants.map((participant) => versionOf(snapshot, participant.key)),
    versionOf(snapshot, transactionKey(original)),
    versionOf(snapshot, headKey(original)),
  ];
  const diff = {
    kind: direction,
    transaction: original,
    participants: head.participants.map((participant) => keyText(participant.key)),
  };
  return { writes, reads, diff, warnings: [] };
}

/** Picks the image to restore: the before image for undo, the after image for redo. */
function imageToRestore(
  transition: Transition,
  direction: Direction,
): StoredRecord | null {
  switch (direction) {
    case 'undo':
      return transition.before;
    case 'redo':
      return transition.after;
  }
}

/**
 * Builds the write that restores a record to an image.
 * A missing or deleted image becomes a delete; a live image restores its exact value and resources.
 */
function restoreRecord(
  transition: Transition,
  image: StoredRecord | null,
): Write {
  if (image === null) return { kind: 'delete', key: transition.key };
  if (image.deleted) return { kind: 'delete', key: transition.key };
  return { kind: 'put', key: transition.key, value: image.value, resources: image.resources };
}

/**
 * Checks the change is in the state the intent needs, then that it may run now.
 * Both matter: equal content after a different edit is still a conflict.
 */
function checkHead(
  snapshot: Snapshot,
  request: Request,
  head: HistoryHead,
): void {
  if (head.state !== requiredState(request))
    reject('revision-conflict', 'history', 'Transaction is not in the required undo/redo state');

  const navigationRecord = findRecord(snapshot, navigationKey);
  if (navigationRecord === null) {
    // Without navigation, the records the change touched must still hold the versions it left.
    compareVersions(snapshot, head.participants);
    return;
  }
  checkNavigation(snapshot, request);
}

/** Returns the state a change must be in: `active` to undo it, `undone` to redo it. */
function requiredState(request: Request): HistoryHead['state'] {
  if (request.intent.kind === 'undo') return 'active';
  return 'undone';
}

/** Checks the change is the next step in navigation, and the request saw the current navigation version. */
function checkNavigation(
  snapshot: Snapshot,
  request: Request,
): void {
  if (request.intent.kind === 'change') return;

  const history = readNavigation(snapshot);
  if (nextAction(history, request.intent.kind) !== request.intent.transaction)
    reject(
      'revision-conflict',
      'history',
      'Only the next chronological action can be undone or redone',
    );
  checkNavigationToken(snapshot, request);
}

/** Checks the request's expected versions include the navigation record, and that it is unchanged. */
function checkNavigationToken(
  snapshot: Snapshot,
  request: Request,
): void {
  const navigationText = keyText(navigationKey);
  const token = request.expected.find((read) => keyText(read.key) === navigationText);
  if (token === undefined)
    reject('invalid-input', 'expected', 'An inverse requires the observed navigation version');
  compareVersions(snapshot, [token]);
}

/** Checks both retained images of a transition belong to its record, before either can be restored. */
function checkTransitionIdentity(transition: Transition): void {
  checkImageIdentity(transition.after, transition.key);
  if (transition.before === null) return;
  checkImageIdentity(transition.before, transition.key);
}

/** Rejects an image stored for a different record. Corrupt history is never silently repaired. */
function checkImageIdentity(
  image: StoredRecord,
  expected: RecordKey,
): void {
  if (keyText(image.key) !== keyText(expected))
    reject('corrupt-record', 'history', 'Historical image belongs to another participant');
}
