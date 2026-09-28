/*
 * One check per argument value: read scope, change mode, revision, collection ID, request ID, file
 * path, profile, server and workspace. Each mints its brand once, from flag text as given, and
 * fills its default. Pure. A rejected value is a failure naming the argument; nothing was read or
 * sent, so the caller corrects it and runs the command again.
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
import type { CommandFlags } from './flags.js';

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
 * --section or --object as a read scope; neither means the whole collection. Fails with
 * `invalid-arguments` when the ID is not a canonical ID.
 */
export function checkReadScope(flags: Pick<CommandFlags, 'section' | 'object'>): Result<ReadScope> {
  if (flags.section !== undefined) {
    return checkSectionScope(flags.section);
  }
  if (flags.object !== undefined) {
    return checkObjectScope(flags.object);
  }
  return success({ kind: 'all' });
}

/**
 * The change mode. A change command (`create`, `replace`, `patch`) is its own mode; any other
 * command checks --mode (`create` when absent). Fails with `invalid-mode`.
 */
export function checkChangeMode(
  name: CommandName,
  flags: Pick<CommandFlags, 'mode'>,
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
 * --revision: a whole number from 0 to `Number.MAX_SAFE_INTEGER`; absent stays absent. Fails with
 * `invalid-revision`.
 */
export function checkRevisionOption(flags: Pick<CommandFlags, 'revision'>): Result<RevisionOption> {
  if (flags.revision === undefined) {
    return success({});
  }
  const revision = checkRevision(flags.revision);
  if (!revision.ok) {
    return revision;
  }
  return success({ revision: revision.value });
}

/** A collection ID operand (`read`, `inspect`). Fails with `invalid-arguments`. */
export function checkCollectionId(collectionText: string): Result<CollectionId> {
  return checked(collectionId, collectionText, {
    code: 'invalid-arguments',
    message: 'Collection IDs must be canonical IDs: a letter, then letters, digits, _ or -.',
  });
}

/** A request ID operand (`receipt`, `retry`, `apply`) or --request. Fails with `invalid-request`. */
export function checkRequestId(requestText: string): Result<RequestId> {
  return checked(requestId, requestText, {
    code: 'invalid-request',
    message: 'Request ID is invalid',
  });
}

/** --request; absent stays absent and a fresh ID is minted later. Fails with `invalid-request`. */
export function checkRequestOption(flags: Pick<CommandFlags, 'request'>): Result<RequestOption> {
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
 * A FILE operand. Only an empty path fails here, with the text its read would give:
 * `source-unavailable`. It fails before the credential read, the server check or any send.
 */
export function checkSourceFile(fileText: string): Result<FilePath> {
  return checked(filePath, fileText, unreadableSource(fileText));
}

/**
 * --out; absent stays absent. An empty path fails with the text its write would give:
 * `output-unavailable`. It fails before the command runs, so nothing is sent or committed.
 */
export function checkOutOption(flags: Pick<CommandFlags, 'out'>): Result<OutOption> {
  if (flags.out === undefined) {
    return success({});
  }
  const out = checked(filePath, flags.out, unwritableOutput(flags.out));
  if (!out.ok) {
    return out;
  }
  return success({ out: out.value });
}

/** A profile operand or --profile. Fails with `unknown-profile`. */
export function checkProfile(profileText: string): Result<ProfileId> {
  return checked(profileId, profileText, {
    code: 'unknown-profile',
    message: `Unknown profile: ${profileText}`,
    recovery: 'Use build-spec@1.',
  });
}

/**
 * Checks where to send the command (`--server`) and which workspace folder to use (`--workspace`).
 * If `--server` wasn't typed, the local service's usual address is used. If `--workspace` wasn't
 * typed, `defaultWorkspace` is used. Stops with `invalid-server` at an address that isn't the local
 * service, before any credential is read.
 */
export function checkServiceOptions(
  flags: Pick<CommandFlags, 'server' | 'workspace'>,
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
