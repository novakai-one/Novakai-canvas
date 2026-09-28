/*
 * Why this file exists
 *
 * Everything an agent types is text. In `pnpm canvas replace plan.canvas --revision 3`, the `3` is
 * text, not a number, and has to be checked before the CLI can use it.
 *
 * This file has one check per kind of value, such as a revision, a collection ID or a file path.
 * Each turns the text into a checked type, or says what was wrong. It never opens a file or talks
 * to the service.
 */
import {
  collectionId,
  collectionRevision,
  filePath,
  loopbackOrigin,
  objectId,
  profileId,
  requestId,
  sectionId,
} from '../../contract/brands.js';
import type {
  CollectionId,
  CollectionRevision,
  FilePath,
  LoopbackOrigin,
  ProfileId,
  RequestId,
} from '../../contract/brands.js';
import type {
  ChangeMode,
  CommandName,
  OutOption,
  ReadScope,
  RequestOption,
  RevisionOption,
  ServerAndWorkspace,
} from '../../contract/records/command.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import {
  failure,
  success,
  unreadableSourceFailure,
  unwritableOutputFailure,
} from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { FlagTextAsTyped } from './flags.js';

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
 * Works out which part of a collection `read` returns: one section, one object, or all of it.
 *
 * `--section intro` gives that section. With neither flag, it is the whole collection.
 * The mistake it can find: a section or object ID that isn't valid (`invalid-arguments`).
 */
export function checkReadScope(
  flags: Pick<FlagTextAsTyped, 'section' | 'object'>,
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
 * The commands `create`, `replace` and `patch` are their own mode. Any other gets `--mode`, or
 * `create` when it wasn't typed. The mistake it can find: a `--mode` that isn't one of the three.
 */
export function checkChangeMode(
  name: CommandName,
  flags: Pick<FlagTextAsTyped, 'mode'>,
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
 * Checks `--revision`, the revision of the collection the agent last read.
 *
 * `--revision 3` gives `{ revision: 3 }`. With no `--revision`, it gives `{}`.
 * The mistake it can find: anything but a whole number from 0 up, such as `-1` or `abc`.
 */
export function checkRevisionOption(
  flags: Pick<FlagTextAsTyped, 'revision'>,
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
 * Checks the collection ID typed after `read` or `inspect`, such as `my-diagram`.
 *
 * The mistake it can find: an ID that isn't a letter followed by letters, digits, `_` or `-`.
 */
export function checkCollectionId(typedCollectionId: string): Result<CollectionId> {
  return checked(collectionId, typedCollectionId, {
    code: 'invalid-arguments',
    message: 'Collection IDs must be canonical IDs: a letter, then letters, digits, _ or -.',
  });
}

/**
 * Checks a request ID, the name of one change the CLI sends, such as `req-1`.
 *
 * It is typed after `receipt`, `retry` or `apply`, or after `--request`.
 * The mistake it can find: an ID that isn't 1 to 120 letters, digits, `_`, `.`, `:` or `-`,
 * starting with a letter or digit (`invalid-request`).
 */
export function checkRequestId(typedRequestId: string): Result<RequestId> {
  return checked(requestId, typedRequestId, {
    code: 'invalid-request',
    message: 'Request ID is invalid',
  });
}

/**
 * Checks `--request`, the request ID the agent picks for the change the command sends.
 *
 * With no `--request`, it gives `{}`, and a new ID is made when the change is sent.
 * The mistake it can find: text that isn't a valid request ID (`invalid-request`).
 */
export function checkRequestOption(flags: Pick<FlagTextAsTyped, 'request'>): Result<RequestOption> {
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
 *
 * The file itself is read later.
 * The mistake it can find: an empty path (`source-unavailable`, as for a file that can't be read).
 */
export function checkFilePath(typedFilePath: string): Result<FilePath> {
  const path = filePath.safeParse(typedFilePath);
  if (!path.success) {
    return unreadableSourceFailure(typedFilePath);
  }
  return success(path.data);
}

/**
 * Checks `--out`, the file the command's answer is written to.
 *
 * With no `--out`, it gives `{}`, and the answer is printed instead.
 * The mistake it can find: an empty path (`output-unavailable`), found before anything is sent.
 */
export function checkOutOption(flags: Pick<FlagTextAsTyped, 'out'>): Result<OutOption> {
  if (flags.out === undefined) {
    return success({});
  }
  const out = filePath.safeParse(flags.out);
  if (!out.success) {
    return unwritableOutputFailure(flags.out);
  }
  return success({ out: out.data });
}

/**
 * Checks a profile ID as typed, such as `build-spec@1`.
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
 *
 * Left out, they are the local service's usual address and `defaultWorkspace`.
 * The mistake it can find: a `--server` not on this machine, such as `http://example.com`, so the
 * agent's access token is never sent anywhere else (`invalid-server`).
 */
export function checkServerAndWorkspace(
  flags: Pick<FlagTextAsTyped, 'server' | 'workspace'>,
  defaultWorkspace: FilePath,
): Result<ServerAndWorkspace> {
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
