/*
 * Workspace startup policy. An existing workspace is validated as stored and never rewritten; a
 * new one gets the installation request as one ordinary Authoring apply. Either way, the stored
 * history is then adopted. Pure over the owners compose injects. A failed startup leaves the
 * stored records as they were; compose closes the native handles and the caller retries.
 */
import type {
  AuthoringResult,
  CandidateValidator,
  Request,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { StartupKind } from '../../contract/records/workspace/startup.js';
import type { WorkspaceSession } from '../../contract/types.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { liveRecords } from '../workspace/records.js';

/** What startup reads, validates, applies and adopts through. */
export interface StartupOwners {
  readonly session: Pick<WorkspaceSession, 'read' | 'apply'>;
  readonly existingWorkspaceCheck: Pick<CandidateValidator, 'validate'>;
  /** The seed request; only a new workspace applies it. */
  readonly seedRequest: AuthoringResult<Request>;
  /** The signal the seed apply runs under; compose passes one that never aborts. */
  readonly signal: AbortSignal;
  readonly startHistory: () => Promise<AuthoringResult<unknown>>;
}

/**
 * Starts one wired workspace: read it, validate it (existing) or initialize it (new), then adopt
 * its history. Every failure keeps the owner's diagnostic as source:
 * - `unavailable` at Authoring's path when the workspace cannot be read;
 * - `unavailable` at the validator's path when an existing workspace fails validation;
 * - `invalid-input` at its path when the installation request could not be built;
 * - `unavailable` at Authoring's path when the installation apply or history adoption is refused.
 */
export async function startWorkspace(owners: StartupOwners): Promise<Result<void>> {
  const snapshot = await owners.session.read();
  if (!snapshot.ok) return started(snapshot);
  const prepared = await prepare(workspaceState(snapshot.value), snapshot.value, owners);
  if (!prepared.ok) return prepared;
  return started(await owners.startHistory());
}

/** The installation apply's options: none, so Authoring checks no candidate hash. */
const NO_APPLY_OPTIONS = Object.freeze({});

/** `existing` when the snapshot holds a live workspace record, otherwise `new`. Never fails. */
function workspaceState(snapshot: Snapshot): StartupKind {
  if (liveRecords(snapshot, 'workspace').length > 0) return 'existing';
  return 'new';
}

/** Validates an existing workspace or initializes a new one. Fails as `startWorkspace` names. */
function prepare(
  state: StartupKind,
  snapshot: Snapshot,
  owners: StartupOwners,
): Promise<Result<void>> {
  switch (state) {
    case 'existing':
      return validateExisting(snapshot, owners);
    case 'new':
      return initializeNew(owners);
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
  owners: StartupOwners,
): Promise<Result<void>> {
  return started(await owners.existingWorkspaceCheck.validate(snapshot, snapshot, []));
}

/**
 * Applies the installation request once. Fails with `invalid-input` at its path when it could not
 * be built, and `unavailable` at Authoring's path when Authoring refuses it.
 */
async function initializeNew(owners: StartupOwners): Promise<Result<void>> {
  const request = owners.seedRequest;
  if (!request.ok) {
    return failure('invalid-input', request.error.path, request.error.message, request.error);
  }
  return started(await owners.session.apply(request.value, owners.signal, NO_APPLY_OPTIONS));
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
