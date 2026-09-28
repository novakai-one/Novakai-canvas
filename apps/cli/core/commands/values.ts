/*
 * Why this file exists
 *
 * Everything an agent types is text. In `pnpm canvas replace plan.canvas --revision 3`, the `3` is
 * text, not a number. Before the CLI can use a value, it has to check the text makes sense and
 * turn it into a checked type. `3` becomes a checked revision number. A `--server` address must be
 * this machine (`http://127.0.0.1:…`), so the agent's token is never sent anywhere else.
 *
 * This file has one check per kind of value: which part of a collection to read, the change mode,
 * the revision, a collection ID, a request ID, a file path, a profile, and where to send the
 * command. When a flag was left out, its check fills in the usual value, such as `--mode create`.
 *
 * A check named `check…Option` is for a flag that may be left out, and returns an `…Option` type:
 * `{ revision: 3 }` for `--revision 3`, or `{}` when `--revision` wasn't typed.
 *
 * It only checks text. It never opens a file or talks to the service. Each check answers with a
 * `Result` (see `contract/errors.ts`), and a value typed wrong comes back as a mistake naming it.
 * Those mistakes are written here, by the check that finds them.
 */
import {
  collectionId,
  collectionRevision,
  filePath,
  loopbackOrigin,
  objectId,
  requestId,
  sectionId,
} from '../../contract/brands.js';
import type {
  CollectionId,
  CollectionRevision,
  FilePath,
  LoopbackOrigin,
  RequestId,
} from '../../contract/brands.js';
import { profileId } from '../../contract/records/profiles.js';
import type { ProfileId } from '../../contract/records/profiles.js';
import type {
  ChangeMode,
  CommandName,
  OutOption,
  ReadScope,
  RequestOption,
  RevisionOption,
  ServiceOptions,
} from '../../contract/records/command.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success, unreadableSource, unwritableOutput } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { TypedFlagText } from './flags.js';

/** The service origin when --server is absent: the local service's default port. */
const defaultServer = 'http://127.0.0.1:5174';

/** The workspace when --workspace is empty: Node resolves `''` and `.` to the same directory. */
const currentDirectory = '.';

/** The change mode when --mode is absent. */
const defaultMode: ChangeMode = 'create';

/** Every change mode, keyed by itself. */
const changeModes: Readonly<Record<ChangeMode, ChangeMode>> = Object.freeze({
  create: 'create',
  replace: 'replace',
  patch: 'patch',
});

/** Digits only: the text a revision may be written as. */
const wholeNumberText = /^[0-9]+$/;

/** A --section or --object ID that is not a canonical ID. */
const invalidScopeId: FailureInput = Object.freeze({
  code: 'invalid-arguments',
  message: 'Read scope IDs must be non-empty canonical IDs.',
});

/** A --revision that is not a whole number within the safe-integer range. */
const invalidRevision: FailureInput = Object.freeze({
  code: 'invalid-revision',
  message: 'Revision must be a non-negative safe integer',
});

/**
 * Works out which part of a collection `read` returns: one section (`--section intro`), one object
 * (`--object customer`), or all of it when neither was typed.
 *
 * The mistake it can find: a section or object ID that isn't valid (`invalid-arguments`).
 */
export function checkReadScope(
  flags: Pick<TypedFlagText, 'section' | 'object'>,
): Result<ReadScope> {
  if (flags.section !== undefined) {
    return checkSectionScope(flags.section);
  }
  if (flags.object !== undefined) {
    return checkObjectScope(flags.object);
  }
  return success({ kind: 'all' });
}

/**
 * Works out how a file changes a collection: `create`, `replace` or `patch`.
 *
 * The commands `create`, `replace` and `patch` are their own mode. Any other command uses
 * `--mode`, or `create` when it wasn't typed. `preview` is the command that needs it.
 *
 * The mistake it can find: a `--mode` that isn't one of the three (`invalid-mode`).
 */
export function checkChangeMode(
  name: CommandName,
  flags: Pick<TypedFlagText, 'mode'>,
): Result<ChangeMode> {
  if (isChangeCommand(name)) {
    return success(name);
  }
  const modeText = flags.mode ?? defaultMode;
  if (!isChangeMode(modeText)) {
    return failure({ code: 'invalid-mode', message: 'Mode must be create, replace or patch' });
  }
  return success(modeText);
}

/**
 * Checks `--revision`, the collection revision the agent last read. It must be a whole number from
 * 0 up, such as `3`. When it wasn't typed, it stays left out.
 *
 * The mistake it can find: anything else, such as `-1`, `abc` or a number too large
 * (`invalid-revision`).
 */
export function checkRevisionOption(
  flags: Pick<TypedFlagText, 'revision'>,
): Result<RevisionOption> {
  if (flags.revision === undefined) {
    return success({});
  }
  const revision = checkRevision(flags.revision);
  if (!revision.ok) {
    return revision;
  }
  return success({ revision: revision.value });
}

/**
 * Checks the collection ID typed after `read` or `inspect`. `typedCollectionId` is the text as
 * typed, such as `my-diagram`.
 *
 * The mistake it can find: an ID that isn't a letter followed by letters, digits, `_` or `-`
 * (`invalid-arguments`).
 */
export function checkCollectionId(typedCollectionId: string): Result<CollectionId> {
  return checked(collectionId, typedCollectionId, {
    code: 'invalid-arguments',
    message: 'Collection IDs must be canonical IDs: a letter, then letters, digits, _ or -.',
  });
}

/**
 * Checks a request ID: the word typed after `receipt`, `retry` or `apply`, or the text after
 * `--request`. `typedRequestId` is the text as typed.
 *
 * The mistake it can find: text that isn't a valid request ID (`invalid-request`).
 */
export function checkRequestId(typedRequestId: string): Result<RequestId> {
  return checked(requestId, typedRequestId, {
    code: 'invalid-request',
    message: 'Request ID is invalid',
  });
}

/**
 * Checks `--request`, a fixed ID for the change the command sends, so its receipt (the service's
 * record that the change was saved) can be looked up later. When it wasn't typed, it stays left
 * out, and a new ID is made when the change is sent.
 *
 * The mistake it can find: text that isn't a valid request ID (`invalid-request`).
 */
export function checkRequestOption(flags: Pick<TypedFlagText, 'request'>): Result<RequestOption> {
  if (flags.request === undefined) {
    return success({});
  }
  const request = checkRequestId(flags.request);
  if (!request.ok) {
    return request;
  }
  return success({ request: request.value });
}

/**
 * Checks the file path typed after the command, such as `plan.canvas` in `create plan.canvas`.
 * `typedFilePath` is the path as typed. The file itself is read later.
 *
 * The mistake it can find: an empty path. It is reported as `source-unavailable`, the same mistake
 * as a file that can't be read, so the agent gets one message for any bad file. It is found before
 * anything is sent.
 */
export function checkFilePath(typedFilePath: string): Result<FilePath> {
  return checked(filePath, typedFilePath, unreadableSource(typedFilePath));
}

/**
 * Checks `--out`, the file the command's answer is written to. When it wasn't typed, it stays left
 * out, and the answer is printed instead.
 *
 * The mistake it can find: an empty path (`output-unavailable`, the same message a failed write
 * gives). It is found before the command runs, so nothing is sent or saved.
 */
export function checkOutOption(flags: Pick<TypedFlagText, 'out'>): Result<OutOption> {
  if (flags.out === undefined) {
    return success({});
  }
  const out = checked(filePath, flags.out, unwritableOutput(flags.out));
  if (!out.ok) {
    return out;
  }
  return success({ out: out.value });
}

/**
 * Checks a profile ID, typed after `profile describe`, `profile scaffold` or `--profile`.
 * `typedProfileId` is the text as typed, such as `build-spec@1`.
 *
 * The mistake it can find: a profile the CLI doesn't know (`unknown-profile`).
 */
export function checkProfileId(typedProfileId: string): Result<ProfileId> {
  return checked(profileId, typedProfileId, {
    code: 'unknown-profile',
    message: `Unknown profile: ${typedProfileId}`,
    recovery: 'Use build-spec@1.',
  });
}

/**
 * Checks where to send the command (`--server`) and which workspace folder to use (`--workspace`).
 * If `--server` wasn't typed, the local service's usual address is used. If `--workspace` wasn't
 * typed, `defaultWorkspace` is used.
 *
 * The mistake it can find: a `--server` that isn't an address on this machine, such as
 * `http://example.com` (`invalid-server`). It is found before any credential is read.
 */
export function checkServerAndWorkspace(
  flags: Pick<TypedFlagText, 'server' | 'workspace'>,
  defaultWorkspace: FilePath,
): Result<ServiceOptions> {
  const server = checkServer(flags.server ?? defaultServer);
  if (!server.ok) {
    return server;
  }
  const workspace = chooseWorkspace(flags.workspace, defaultWorkspace);
  if (!workspace.ok) {
    return workspace;
  }
  return success({ server: server.value, workspace: workspace.value });
}

/** The typed `--workspace`, checked; or `defaultWorkspace` when it wasn't typed. */
function chooseWorkspace(
  typedWorkspace: string | undefined,
  defaultWorkspace: FilePath,
): Result<FilePath> {
  if (typedWorkspace === undefined) {
    return success(defaultWorkspace);
  }
  return checkWorkspace(typedWorkspace);
}

/** A --section ID as a section scope. Fails with `invalid-arguments`. */
function checkSectionScope(sectionText: string): Result<ReadScope> {
  const id = checked(sectionId, sectionText, invalidScopeId);
  if (!id.ok) {
    return id;
  }
  return success({ kind: 'section', id: id.value });
}

/** An --object ID as an object scope. Fails with `invalid-arguments`. */
function checkObjectScope(objectText: string): Result<ReadScope> {
  const id = checked(objectId, objectText, invalidScopeId);
  if (!id.ok) {
    return id;
  }
  return success({ kind: 'object', id: id.value });
}

/**
 * --revision text as a revision: digits only, within the safe-integer range. Fails with
 * `invalid-revision`.
 */
function checkRevision(revisionText: string): Result<CollectionRevision> {
  if (!wholeNumberText.test(revisionText)) {
    return failure(invalidRevision);
  }
  return checked(collectionRevision, Number(revisionText), invalidRevision);
}

/**
 * The origin the agent token may go to: an `http://127.0.0.1` origin, never a remote host. Fails
 * with `invalid-server`: text that is not a URL first, then a URL that is not a loopback origin.
 */
function checkServer(serverText: string): Result<LoopbackOrigin> {
  if (!URL.canParse(serverText)) {
    return failure({ code: 'invalid-server', message: 'Server URL is invalid' });
  }
  return checked(loopbackOrigin, serverText, {
    code: 'invalid-server',
    message: 'Server must be an IPv4 loopback HTTP origin',
  });
}

/**
 * The directory holding the agent credential and the request journal. Every text is accepted: an
 * empty one is the current directory. Fails with `invalid-arguments` only if that were empty.
 */
function checkWorkspace(workspaceText: string): Result<FilePath> {
  const directoryText = fillEmptyWorkspace(workspaceText);
  return checked(filePath, directoryText, {
    code: 'invalid-arguments',
    message: 'Workspace must be a directory path.',
  });
}

/** An empty --workspace becomes `.`: Node resolves `''` to the current directory too. */
function fillEmptyWorkspace(workspaceText: string): string {
  if (workspaceText === '') {
    return currentDirectory;
  }
  return workspaceText;
}

/** Whether the command is `create`, `replace` or `patch`: its name is also its change mode. */
function isChangeCommand(name: CommandName): name is 'create' | 'replace' | 'patch' {
  return isChangeMode(name);
}

/** Whether `text` is one of the three change modes. */
function isChangeMode(text: string): text is ChangeMode {
  return Object.hasOwn(changeModes, text);
}
