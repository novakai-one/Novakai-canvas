/*
 * Why this file exists
 *
 * `pnpm dev --workspace ./my-workspace` may open a workspace used before, or an empty folder. A
 * used one must be checked but never rewritten. An empty one needs its first records (the workspace
 * details, an empty `main` catalog, the shipped themes and recipes) before anyone can use it.
 *
 * This file decides which it is (a stored `workspace` record means used), then checks it, or saves
 * the seed as one ordinary Authoring apply. Then it starts undo history. Each step answers a
 * `Result` (contract/errors.ts) and the first mistake stops start-up. It never deletes anything.
 */
import type {
  AuthoringDiagnostic,
  AuthoringResult,
  CandidateValidator,
  HistoryStatus,
  RecordKey,
  Request,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { StartupKind } from '../../contract/records/workspace/startup.js';
import type { WorkspaceSession } from '../../contract/types.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { listLiveRecords } from '../workspace/records.js';

/** What start-up reads, checks and saves through. Compose passes the built workspace. */
export interface StartupDependencies {
  /** The session start-up reads the workspace from, and saves the seed through. */
  readonly session: Pick<WorkspaceSession, 'read' | 'apply'>;
  /** Authoring's check of a whole workspace; start-up runs it on a used workspace as stored. */
  readonly candidateCheck: Pick<CandidateValidator, 'validate'>;
  /** The request that saves a new workspace's first records, or why it couldn't be made. */
  readonly seedRequest: AuthoringResult<Request>;
  /** The signal the seed save runs under; compose passes one that never aborts. */
  readonly signal: AbortSignal;
  /** Starts undo history for a workspace that has none, or checks the history it has. */
  readonly startHistory: () => Promise<AuthoringResult<HistoryStatus>>;
}

/**
 * Checks a used workspace, or saves the seed into a new one, then starts undo history.
 * Fails with `invalid-input` when the seed request couldn't be made, or `unavailable` when the
 * workspace can't be read or checked, or Authoring refuses the seed or history. The failing
 * part's own diagnostic is kept as `source`.
 */
export async function startWorkspace(dependencies: StartupDependencies): Promise<Result<void>> {
  const snapshot = await readStoredWorkspace(dependencies);
  if (!snapshot.ok) {
    return snapshot;
  }
  const kind = findStartupKind(snapshot.value);
  const prepared = await prepareWorkspace(kind, snapshot.value, dependencies);
  if (!prepared.ok) {
    return prepared;
  }
  return startUndoHistory(dependencies);
}

/** The seed save's apply options: none, so Authoring checks no candidate hash. */
const NO_APPLY_OPTIONS = Object.freeze({});

/** Start-up changes no records, so the check of a used workspace is told none changed. */
const NO_CHANGED_RECORDS: readonly RecordKey[] = Object.freeze([]);

/** Reads the workspace as it is stored now. */
async function readStoredWorkspace(dependencies: StartupDependencies): Promise<Result<Snapshot>> {
  const snapshot = await dependencies.session.read();
  if (!snapshot.ok) {
    return refusedStepFailure(snapshot.error);
  }
  return success(snapshot.value);
}

/** Says whether the workspace was used before (`existing`) or is `new`. */
function findStartupKind(snapshot: Snapshot): StartupKind {
  if (hasWorkspaceRecord(snapshot)) {
    return 'existing';
  }
  return 'new';
}

/** Whether the snapshot holds a live `workspace` record, which only a used workspace has. */
function hasWorkspaceRecord(snapshot: Snapshot): boolean {
  const workspaceRecords = listLiveRecords(snapshot, 'workspace');
  return workspaceRecords.length > 0;
}

/** Checks an existing workspace as stored, or saves the seed into a new one. */
async function prepareWorkspace(
  kind: StartupKind,
  snapshot: Snapshot,
  dependencies: StartupDependencies,
): Promise<Result<void>> {
  switch (kind) {
    case 'existing':
      return checkExistingWorkspace(snapshot, dependencies);
    case 'new':
      return seedNewWorkspace(dependencies);
    default:
      return unknownStartupKindFailure(kind);
  }
}

/**
 * Runs Authoring's whole-workspace check on the stored workspace, as both the before and the after,
 * because start-up changes nothing. Nothing is written.
 */
async function checkExistingWorkspace(
  snapshot: Snapshot,
  dependencies: StartupDependencies,
): Promise<Result<void>> {
  const checked = await dependencies.candidateCheck.validate(
    snapshot,
    snapshot,
    NO_CHANGED_RECORDS,
  );
  if (!checked.ok) {
    return refusedStepFailure(checked.error);
  }
  return success(undefined);
}

/** Saves a new workspace's first records as one ordinary Authoring apply. */
async function seedNewWorkspace(dependencies: StartupDependencies): Promise<Result<void>> {
  const seedRequest = dependencies.seedRequest;
  if (!seedRequest.ok) {
    return unmadeSeedFailure(seedRequest.error);
  }
  const saved = await dependencies.session.apply(
    seedRequest.value,
    dependencies.signal,
    NO_APPLY_OPTIONS,
  );
  if (!saved.ok) {
    return refusedStepFailure(saved.error);
  }
  return success(undefined);
}

/** Starts undo history, or checks the history the workspace already has. */
async function startUndoHistory(dependencies: StartupDependencies): Promise<Result<void>> {
  const history = await dependencies.startHistory();
  if (!history.ok) {
    return refusedStepFailure(history.error);
  }
  return success(undefined);
}

/**
 * Makes the mistake for a start-up step that was refused (`unavailable`), keeping the refusal as
 * `source`.
 */
function refusedStepFailure(refusal: AuthoringDiagnostic): Result<never> {
  return failure('unavailable', refusal.path, refusal.message, refusal);
}

/**
 * Makes the mistake for a seed request that couldn't be made (`invalid-input`), keeping the reason
 * as `source`.
 */
function unmadeSeedFailure(reason: AuthoringDiagnostic): Result<never> {
  return failure('invalid-input', reason.path, reason.message, reason);
}

/**
 * Makes the mistake for a start-up kind this file doesn't know; it can't happen while `StartupKind`
 * has two members.
 */
function unknownStartupKindFailure(kind: never): Result<never> {
  void kind;
  return failure('unavailable', 'startup', 'Unsupported workspace state');
}
