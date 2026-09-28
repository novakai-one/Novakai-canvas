import { recordId } from '../../contract/brands.js';
import type { RequestId } from '../../contract/brands.js';
import { navigationSchema, historyStatusSchema } from '../../contract/records/history.js';
import type {
  HistoryNavigation,
  HistoryStatus,
  HistoryAction,
  HistoryHead,
  Transaction,
} from '../../contract/records/history.js';
import type {
  Snapshot,
  RecordKey,
  ReadVersion,
  StoredRecord,
} from '../../contract/records/storage.js';
import type { Request } from '../../contract/records/request.js';
import { readTransaction, readHead } from './read.js';
import { findRecord, versionOf, keyText } from '../records/keys.js';
import { uniqueKeys, compareVersions } from '../records/versions.js';
import { readShape } from '../validation/input.js';
import { storedLimits } from '../validation/plain-data.js';
import { reject } from '../validation/outcomes.js';

/** The direction of a step through history. */
export type Direction = 'undo' | 'redo';

/** The key of the single history record that stores undo/redo navigation. */
export const navigationKey: RecordKey = { kind: 'history', id: recordId.parse('navigation') };

/**
 * Checked navigation per frozen snapshot. Only history adoption creates a first navigation
 * record; reading never invents one.
 */
const navigations = new WeakMap<Snapshot, HistoryNavigation>();

/**
 * Reads and fully checks the workspace's history navigation.
 *
 * Checks: the record exists and is live, the cursor is within the steps, no step repeats, the
 * frontier lists every content record at its current version, and every step's transaction and
 * head are stored, consistent and in the state the cursor implies. The result is cached for a
 * frozen snapshot.
 *
 * @param snapshot - The current workspace snapshot.
 * @returns The checked navigation.
 * @throws AuthoringFault `corrupt-record` when navigation or any step's history is missing, malformed or inconsistent.
 * @throws AuthoringFault `unknown-reference` when a step's transaction or head is missing.
 * @throws AuthoringFault `invalid-input` when the frontier or a step's history repeats a record key,
 *   or a step's transaction is itself an undo or redo.
 * @throws AuthoringFault `revision-conflict` when a frontier version differs from the snapshot.
 */
export function readNavigation(snapshot: Snapshot): HistoryNavigation {
  if (!Object.isFrozen(snapshot)) return checkedNavigation(snapshot);
  return cachedNavigation(snapshot);
}

/**
 * Checks a transaction and its head list exactly the same records, each once.
 *
 * A head that lists only some of the records could otherwise authorize a partial undo.
 *
 * @param transaction - The stored transaction.
 * @param head - The stored head of the same change.
 * @throws AuthoringFault `invalid-input` when either list repeats a record key.
 * @throws AuthoringFault `corrupt-record` when the two lists name different records.
 */
export function checkParticipantCoverage(
  transaction: Transaction,
  head: HistoryHead,
): void {
  const transitionKeys = transaction.transitions.map((transition) => transition.key);
  const participantKeys = head.participants.map((participant) => participant.key);
  uniqueKeys(transitionKeys, 'history.transitions');
  uniqueKeys(participantKeys, 'history.participants');

  if (!sameKeys(transitionKeys, participantKeys))
    reject('corrupt-record', 'history', 'History participant coverage differs');
}

/**
 * Picks the step an undo or redo would act on. Pure; it does not check record versions.
 *
 * @param history - The checked navigation.
 * @param direction - `undo` for the step before the cursor, `redo` for the step after it.
 * @returns The step's request ID, or `null` when there is nothing to undo or redo.
 */
export function nextAction(
  history: HistoryNavigation,
  direction: Direction,
): RequestId | null {
  const index = actionIndex(history, direction);
  const action = history.actions[index];
  if (action === undefined) return null;
  return action;
}

/**
 * Moves navigation forward after a committed request.
 *
 * - A change drops every redo step and appends itself; the cursor moves past it.
 *   Retention purges the dropped steps' records in the same commit.
 * - An undo moves the cursor back one step; a redo moves it forward one step.
 * - The frontier takes the new versions of every written record.
 *
 * @param history - The navigation before the request.
 * @param request - The committed request.
 * @param versions - The record versions after the commit.
 * @returns The new navigation.
 */
export function advance(
  history: HistoryNavigation,
  request: Request,
  versions: readonly ReadVersion[],
): HistoryNavigation {
  const frontier = mergedFrontier(history.frontier, versions);
  const actions = actionsAfter(history, request);
  const cursor = cursorAfter(history, request);
  return { ...history, actions, cursor, frontier };
}

/**
 * Builds the undo/redo status shown to clients.
 *
 * Both actions and their expected versions come from the same checked snapshot, so a client can
 * submit them unchanged as the next undo or redo request.
 *
 * @param snapshot - The current workspace snapshot.
 * @returns The navigation version and the next undo and redo actions, or `null` where there is none.
 * @throws AuthoringFault when navigation or a step's history fails its checks (see `readNavigation`).
 */
export function historyStatus(snapshot: Snapshot): HistoryStatus {
  const history = readNavigation(snapshot);
  const status = {
    workspace: snapshot.workspace,
    navigationVersion: versionOf(snapshot, navigationKey),
    undo: historyAction(snapshot, history, 'undo'),
    redo: historyAction(snapshot, history, 'redo'),
  };
  return readShape(historyStatusSchema, status, 'corrupt-record', storedLimits);
}

/**
 * Returns the navigation record's current version, as a read dependency.
 *
 * Prepared candidates depend on it, so an edit made in between cannot silently change which step
 * an undo or redo acts on.
 *
 * @param snapshot - The current workspace snapshot.
 * @returns A list with the navigation record's version.
 */
export function navigationDependencies(snapshot: Snapshot): readonly ReadVersion[] {
  return [versionOf(snapshot, navigationKey)];
}

/** Returns the cached navigation for a frozen snapshot, checking and caching it the first time. */
function cachedNavigation(snapshot: Snapshot): HistoryNavigation {
  const known = navigations.get(snapshot);
  if (known !== undefined) return known;

  const navigation = checkedNavigation(snapshot);
  navigations.set(snapshot, navigation);
  return navigation;
}

/** Reads the navigation record and runs every check on it. */
function checkedNavigation(snapshot: Snapshot): HistoryNavigation {
  const record = findRecord(snapshot, navigationKey);
  if (record === null || record.deleted)
    reject('corrupt-record', 'history', 'History navigation is missing');

  const navigation = readShape(navigationSchema, record.value, 'corrupt-record', storedLimits);
  validateNavigation(navigation, snapshot);
  return navigation;
}

/** Checks the cursor, repeated steps, the frontier and then every step. These are storage invariants. */
function validateNavigation(
  navigation: HistoryNavigation,
  snapshot: Snapshot,
): void {
  if (navigation.cursor > navigation.actions.length)
    reject('corrupt-record', 'history', 'History cursor is out of bounds');

  const distinctActions = new Set(navigation.actions);
  if (distinctActions.size !== navigation.actions.length)
    reject('corrupt-record', 'history', 'History repeats an action');

  validateFrontier(navigation, snapshot);
  navigation.actions.forEach((id, index) => {
    validateAction(snapshot, id, stateAtIndex(index, navigation.cursor));
  });
}

/** Checks one step's transaction and head agree with each other and with the cursor. */
function validateAction(
  snapshot: Snapshot,
  id: RequestId,
  expectedState: HistoryHead['state'],
): void {
  const transaction = readTransaction(snapshot, id);
  const head = readHead(snapshot, id);
  if (head.state !== expectedState)
    reject('corrupt-record', 'history', 'History state disagrees with its cursor');

  checkParticipantCoverage(transaction, head);
  transaction.transitions.forEach((transition) =>
    validateImages(transition.key, [transition.before, transition.after]),
  );
}

/** Steps before the cursor must be `active`; steps at or after it must be `undone`. */
function stateAtIndex(
  index: number,
  cursor: number,
): HistoryHead['state'] {
  if (index < cursor) return 'active';
  return 'undone';
}

/** The step an undo acts on is just before the cursor; the step a redo acts on is at the cursor. */
function actionIndex(
  history: HistoryNavigation,
  direction: Direction,
): number {
  switch (direction) {
    case 'undo':
      return history.cursor - 1;
    case 'redo':
      return history.cursor;
  }
}

/** Checks the frontier lists every content record once, at its current version. */
function validateFrontier(
  navigation: HistoryNavigation,
  snapshot: Snapshot,
): void {
  const frontierKeys = navigation.frontier.map((read) => read.key);
  uniqueKeys(frontierKeys, 'history.frontier');

  const contentKeys = snapshot.records
    .filter((record) => record.key.kind !== 'history')
    .map((record) => record.key);
  if (!sameKeys(contentKeys, frontierKeys))
    reject('corrupt-record', 'history', 'History frontier coverage is incomplete');

  compareVersions(snapshot, navigation.frontier);
}

/** Tells whether two key lists name the same keys, ignoring order. */
function sameKeys(
  left: readonly RecordKey[],
  right: readonly RecordKey[],
): boolean {
  const leftTexts = left.map(keyText).toSorted();
  const rightTexts = right.map(keyText).toSorted();
  if (leftTexts.length !== rightTexts.length) return false;
  return leftTexts.every((text, index) => text === rightTexts[index]);
}

/** Rejects a retained image stored for a different record. */
function validateImages(
  key: RecordKey,
  images: readonly (StoredRecord | null)[],
): void {
  const expectedText = keyText(key);
  const hasForeignImage = images.some(
    (image) => image !== null && keyText(image.key) !== expectedText,
  );
  if (hasForeignImage)
    reject('corrupt-record', 'history', 'Retained image belongs to another participant');
}

/** Returns the frontier with each written record's new version replacing its old one. */
function mergedFrontier(
  frontier: readonly ReadVersion[],
  versions: readonly ReadVersion[],
): ReadVersion[] {
  const byKey = new Map(frontier.map((read) => [keyText(read.key), read]));
  versions.forEach((read) => byKey.set(keyText(read.key), read));
  return [...byKey.values()];
}

/** A change drops the redo steps and appends itself. Undo and redo keep the steps unchanged. */
function actionsAfter(
  history: HistoryNavigation,
  request: Request,
): readonly RequestId[] {
  if (request.intent.kind !== 'change') return history.actions;
  const stepsUpToCursor = history.actions.slice(0, history.cursor);
  return [...stepsUpToCursor, request.request];
}

/** An undo moves the cursor back one step. A change or redo moves it forward one step. */
function cursorAfter(
  history: HistoryNavigation,
  request: Request,
): number {
  switch (request.intent.kind) {
    case 'undo':
      return history.cursor - 1;
    case 'change':
    case 'redo':
      return history.cursor + 1;
  }
}

/** Describes the step an undo or redo would act on, with the versions to submit for it. */
function historyAction(
  snapshot: Snapshot,
  history: HistoryNavigation,
  direction: Direction,
): HistoryAction | null {
  const id = nextAction(history, direction);
  if (id === null) return null;

  const transaction = readTransaction(snapshot, id);
  const scope = transaction.transitions.map((transition) => transition.key);
  const collections = scope.filter((key) => key.kind === 'collection').map((key) => key.id);
  const expected = [
    ...scope.map((key) => versionOf(snapshot, key)),
    versionOf(snapshot, navigationKey),
  ];
  return {
    transaction: id,
    label: transaction.label ?? 'Edit workspace',
    actor: transaction.actor,
    collections,
    scope,
    expected,
  };
}
