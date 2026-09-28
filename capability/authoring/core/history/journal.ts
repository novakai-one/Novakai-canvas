import { transactionSchema, headSchema } from '../../contract/records/history.js';
import type { Transaction } from '../../contract/records/history.js';
import type { Request } from '../../contract/records/request.js';
import type { PreparedCandidate } from '../../contract/records/proposal.js';
import type {
  Json,
  Write,
  ReadVersion,
  CommitOutcome,
  StoredRecord,
  RecordKey,
} from '../../contract/records/storage.js';
import type { Clock } from '../../contract/ports/runtime.js';
import type { PurgeWrite } from '../../contract/ports/store.js';
import { timestamp } from '../../contract/brands.js';
import type { Digest } from '../../contract/brands.js';
import { findRecord, versionOf } from '../records/keys.js';
import { navigationKey, readNavigation, advance } from './navigation.js';
import { transactionKey, headKey } from './read.js';
import { boundNavigation, staleHistory } from './retention.js';
import { checkDependencies } from '../admission/dependencies.js';
import { readShape } from '../validation/input.js';
import { copyJson, storedLimits } from '../validation/plain-data.js';
import { accepted, reject } from '../validation/outcomes.js';

/** A write in a commit: a content or history write, or the purge of an old history record. */
type JournalWrite = Write | PurgeWrite;

/** One record's change inside a stored transaction. */
type Transition = Transaction['transitions'][number];

/** Everything a commit stores, beyond the request identity. */
export interface Journal {
  /** The content writes, then the history writes. */
  readonly writes: readonly JournalWrite[];
  /** Every record version the commit depends on. */
  readonly expected: readonly ReadVersion[];
  /** The outcome stored in the receipt. */
  readonly outcome: CommitOutcome;
}

/**
 * Builds the complete commit for an admitted candidate: content writes, history writes and outcome.
 *
 * - A candidate with no changes commits nothing but still gets a receipt. It has no transaction,
 *   no timestamp and no history. Only a change can be a no-op; an undo or redo must change something.
 * - Otherwise the commit also stores a transaction record (before and after images of every changed
 *   record), the original change's head, and, when the workspace has navigation, the advanced
 *   navigation plus purges of history it no longer reaches.
 *
 * This only builds the writes; it commits nothing. The caller commits all of them in one storage
 * transaction. Failures are thrown as `AuthoringFault`; the Authoring facade turns every failure into
 * a failed `Result`. Retrying after a lost acknowledgement is not handled here: the commit step
 * reconciles the request's receipt first.
 *
 * @param request - The checked submitted request.
 * @param candidate - The admitted candidate.
 * @param clock - The clock used to timestamp the transaction.
 * @returns The writes, expected versions and outcome to commit.
 * @throws AuthoringFault `invariant-violation` when an undo or redo would change nothing.
 * @throws AuthoringFault `corrupt-record` when a generated history key already exists, a changed record
 *   is missing from the candidate, the transaction fails its schema, or the stored navigation
 *   is malformed (see `readNavigation` for every navigation failure).
 * @throws AuthoringFault with the clock's own diagnostic when reading the time fails.
 * @throws AuthoringFault `invalid-input` when the clock's time is not a valid timestamp, the head
 *   fails its schema, or a history record breaks its JSON size limits.
 * @throws AuthoringFault `revision-conflict` when the history writes' versions disagree with the candidate's reads.
 * @throws Any error the clock throws, unchanged. The facade reports it as `storage-unavailable`.
 */
export function createJournal(
  request: Request,
  candidate: PreparedCandidate,
  clock: Clock,
): Journal {
  const prepared = candidate.preparation;
  const outcome = commitOutcome(request, candidate);
  if (prepared.changes.length === 0) return unchangedJournal(request, prepared.reads, outcome);

  checkJournalIdentity(request, candidate);
  const history = historyWrites(request, candidate, clock);
  // The version each history record had before this commit, so the commit fails if it changed.
  const historyReads = history.map((write) => versionOf(candidate.before, write.key));
  return {
    writes: [...prepared.changes, ...history],
    expected: checkDependencies(candidate.before, [prepared.reads, historyReads]),
    outcome,
  };
}

/** Builds the receipt outcome. A candidate with no changes is a `no-op` with no transaction. */
function commitOutcome(
  request: Request,
  candidate: PreparedCandidate,
): CommitOutcome {
  const prepared = candidate.preparation;
  if (prepared.changes.length === 0)
    return {
      status: 'no-op',
      transaction: null,
      pins: prepared.pins,
      diff: prepared.diff,
      warnings: prepared.warnings,
    };
  return {
    status: 'committed',
    transaction: request.request,
    pins: prepared.pins,
    diff: prepared.diff,
    warnings: prepared.warnings,
  };
}

/** Builds the journal for a candidate with no changes. Rejects an undo or redo, which must change something. */
function unchangedJournal(
  request: Request,
  expected: readonly ReadVersion[],
  outcome: CommitOutcome,
): Journal {
  if (request.intent.kind !== 'change')
    reject('invariant-violation', 'history', 'An inverse must restore a changed record');
  return { writes: [], expected, outcome };
}

/**
 * Checks the history keys this commit generates do not exist yet.
 * The only lawful reuse of a request ID is a retry that finds its receipt, which happens earlier.
 */
function checkJournalIdentity(
  request: Request,
  candidate: PreparedCandidate,
): void {
  requireAbsent(candidate, transactionKey(request.request));
  if (request.intent.kind !== 'change') return;
  requireAbsent(candidate, headKey(request.request));
}

/** Rejects a generated history key that already exists, before the commit is attempted. */
function requireAbsent(
  candidate: PreparedCandidate,
  key: RecordKey,
): void {
  if (findRecord(candidate.before, key) !== null)
    reject(
      'corrupt-record',
      'history',
      'Generated history already exists without a reconciled receipt',
    );
}

/**
 * Builds the history writes: the transaction record, the original change's head, and navigation.
 * The transaction record keeps every resource its images use, so undo never loses bytes.
 */
function historyWrites(
  request: Request,
  candidate: PreparedCandidate,
  clock: Clock,
): readonly JournalWrite[] {
  const target = request.intent.kind === 'change' ? null : request.intent.transaction;
  const original = target ?? request.request;

  const transactionTime = readShape(timestamp, accepted(clock.now()));
  const label = actionLabel(candidate);
  // One transition per changed record.
  const transitions = candidate.preparation.changes.map((write) => transition(candidate, write));
  const entry = readShape(
    transactionSchema,
    {
      kind: 'transaction',
      id: request.request,
      actor: request.actor,
      timestamp: transactionTime,
      mode: request.intent.kind,
      label,
      target,
      transitions,
    },
    'corrupt-record',
    storedLimits,
  );
  const retainedResources = [...new Set(entry.transitions.flatMap(transitionResources))];
  const head = readShape(headSchema, {
    kind: 'head',
    original,
    state: headState(request),
    // Each changed record's version after this commit.
    participants: entry.transitions.map((item) => versionOf(candidate.after, item.key)),
    last: request.request,
  });

  const transactionRecordKey = transactionKey(request.request);
  const transactionValue = copyJson(entry, storedLimits);
  const headRecordKey = headKey(original);
  const headValue = copyJson(head);
  // Navigation gets its own key objects, built after the two records above.
  const navigation = navigationWrites(request, candidate, [
    transactionKey(request.request),
    headKey(original),
  ]);
  return [
    {
      kind: 'put',
      key: transactionRecordKey,
      value: transactionValue,
      resources: retainedResources,
    },
    { kind: 'put', key: headRecordKey, value: headValue, resources: [] },
    ...navigation,
  ];
}

/** An undo leaves the original change `undone`. A change or redo leaves it `active`. */
function headState(request: Request): 'active' | 'undone' {
  switch (request.intent.kind) {
    case 'undo':
      return 'undone';
    case 'change':
    case 'redo':
      return 'active';
  }
}

/** Builds one record's transition: its image before the change and its exact stamped image after. */
function transition(
  candidate: PreparedCandidate,
  write: Write,
): unknown {
  const after = findRecord(candidate.after, write.key);
  if (after === null)
    reject('corrupt-record', 'candidate', 'Changed participant is missing from the candidate');
  const before = findRecord(candidate.before, write.key);
  return { key: write.key, before, after };
}

/** Lists the resources a transition's images use. A missing before image uses none. */
function transitionResources(transition: Transition): readonly Digest[] {
  const beforeResources = transition.before === null ? [] : transition.before.resources;
  return [...beforeResources, ...transition.after.resources];
}

/**
 * Builds the navigation writes, when the workspace has navigation: the advanced and bounded
 * navigation, then purges of history records it no longer reaches (except the ones written now).
 */
function navigationWrites(
  request: Request,
  candidate: PreparedCandidate,
  written: readonly RecordKey[],
): readonly JournalWrite[] {
  if (findRecord(candidate.before, navigationKey) === null) return [];

  const navigation = readNavigation(candidate.before);
  // Each changed record's version after this commit.
  const newVersions = candidate.preparation.changes.map((write) =>
    versionOf(candidate.after, write.key),
  );
  const advanced = advance(navigation, request, newVersions);
  const bounded = boundNavigation(candidate.before, advanced);
  return [
    {
      kind: 'put',
      key: navigationKey,
      value: copyJson(bounded, storedLimits),
      resources: [],
    },
    ...staleHistory(candidate.before, bounded.actions, written),
  ];
}

/** Describes the change for people, for example `Edit Sales; Delete Notes`, instead of a request ID. */
function actionLabel(candidate: PreparedCandidate): string {
  // One label per changed record, in write order.
  const labels = candidate.preparation.changes.map((write) => changedLabel(candidate, write));
  return labels.join('; ');
}

/** Describes one write: `Create`, `Edit` or `Delete`, then the record's title or ID. */
function changedLabel(
  candidate: PreparedCandidate,
  write: Write,
): string {
  const before = findRecord(candidate.before, write.key);
  const after = findRecord(candidate.after, write.key);
  const title = recordTitle(after) ?? recordTitle(before) ?? write.key.id;
  if (write.kind === 'delete') return `Delete ${title}`;
  return `${changeVerb(before)} ${title}`;
}

/** A record that was missing or deleted before is created; a live record is edited. */
function changeVerb(before: StoredRecord | null): string {
  if (before === null || before.deleted) return 'Create';
  return 'Edit';
}

/** Reads a record's string `title` field, or `null` when it has none. */
function recordTitle(record: StoredRecord | null): string | null {
  if (record === null) return null;
  return titleOf(record.value);
}

/** Reads the string `title` field of a JSON object, or `null` for any other value. */
function titleOf(value: Json): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return titleField(value);
}

/** Returns the object's `title` when it is a string. */
function titleField(value: object): string | null {
  if (!('title' in value)) return null;
  if (typeof value.title !== 'string') return null;
  return value.title;
}
