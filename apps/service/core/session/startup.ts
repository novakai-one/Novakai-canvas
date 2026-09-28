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
  AuthoringResult,
  CandidateValidator,
  HistoryStatus,
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
  const snapshot = await dependencies.session.read();
  if (!snapshot.ok) return started(snapshot);
  const prepared = await prepare(workspaceState(snapshot.value), snapshot.value, dependencies);
  if (!prepared.ok) return prepared;
  return started(await dependencies.startHistory());
}

/** The installation apply's options: none, so Authoring checks no candidate hash. */
const NO_APPLY_OPTIONS = Object.freeze({});

/** `existing` when the snapshot holds a live workspace record, otherwise `new`. Never fails. */
function workspaceState(snapshot: Snapshot): StartupKind {
  if (listLiveRecords(snapshot, 'workspace').length > 0) return 'existing';
  return 'new';
}

/** Validates an existing workspace or initializes a new one. Fails as `startWorkspace` names. */
function prepare(
  state: StartupKind,
  snapshot: Snapshot,
  dependencies: StartupDependencies,
): Promise<Result<void>> {
  switch (state) {
    case 'existing':
      return validateExisting(snapshot, dependencies);
    case 'new':
      return initializeNew(dependencies);
    default:
      return unsupported(state);
  }
}

/**
 * Validates the stored workspace as it is; nothing is written. Fails with `unavailable` at the
 * validator's path.
 */
async function validateExisting(
  snapshot: Snapshot,
  dependencies: StartupDependencies,
): Promise<Result<void>> {
  return started(await dependencies.candidateCheck.validate(snapshot, snapshot, []));
}

/**
 * Applies the installation request once. Fails with `invalid-input` at its path when it could not
 * be built, and `unavailable` at Authoring's path when Authoring refuses it.
 */
async function initializeNew(dependencies: StartupDependencies): Promise<Result<void>> {
  const request = dependencies.seedRequest;
  if (!request.ok) {
    return failure('invalid-input', request.error.path, request.error.message, request.error);
  }
  return started(
    await dependencies.session.apply(request.value, dependencies.signal, NO_APPLY_OPTIONS),
  );
}

/** An owner's answer as startup's: a refusal is `unavailable`, with the owner's diagnostic kept. */
function started(result: AuthoringResult<unknown>): Result<void> {
  if (!result.ok) {
    return failure('unavailable', result.error.path, result.error.message, result.error);
  }
  return success(undefined);
}

/** Unreachable: `StartupKind` has two members. Answers `unavailable` at `startup`. */
async function unsupported(state: never): Promise<Result<void>> {
  void state;
  return failure('unavailable', 'startup', 'Unsupported workspace state');
}
