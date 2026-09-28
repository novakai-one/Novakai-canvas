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
  profileId,
  requestId,
  sectionId,
} from '../../contract/brands.js';
import type {
  CollectionId,
  FilePath,
  LoopbackOrigin,
  ProfileId,
  RequestId,
} from '../../contract/brands.js';
import type {
  ChangeMode,
  CommandName,
  ReadScope,
  Retains,
  Revises,
  ServiceOptions,
  Writes,
} from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { failure, success, unreadableSource, unwritableOutput } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../../contract/schemas.js';
import { joined, mapped } from '../shared/results.js';
import type { CommandDefaults, CommandFlags } from './flags.js';

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

/**
 * --section or --object as a read scope; neither means the whole collection. Fails with
 * `invalid-arguments` when the ID is not a canonical ID.
 */
export function readScope(flags: Pick<CommandFlags, 'section' | 'object'>): Result<ReadScope> {
  if (flags.section !== undefined)
    return mapped(scopeId(sectionId, flags.section), (id) => ({ kind: 'section', id }));
  if (flags.object !== undefined)
    return mapped(scopeId(objectId, flags.object), (id) => ({ kind: 'object', id }));
  return success({ kind: 'all' });
}

/**
 * The change mode: `create`, `replace` and `patch` are their own mode; any other command checks
 * --mode (`create` when absent). Fails with `invalid-mode`.
 */
export function changeMode(
  name: CommandName,
  flags: Pick<CommandFlags, 'mode'>,
): Result<ChangeMode> {
  const selected = isChangeMode(name) ? name : modeText(flags);
  if (!isChangeMode(selected))
    return failure({ code: 'invalid-mode', message: 'Mode must be create, replace or patch' });
  return success(selected);
}

/**
 * --revision: a whole number from 0 to `Number.MAX_SAFE_INTEGER`; absent stays absent. Fails with
 * `invalid-revision`.
 */
export function revises(text: string | undefined): Result<Revises> {
  if (text === undefined) return success({});
  const digits = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
  return mapped(
    checked(collectionRevision, digits, {
      code: 'invalid-revision',
      message: 'Revision must be a non-negative safe integer',
    }),
    (revision) => ({ revision }),
  );
}

/** A collection ID operand (`read`, `inspect`). Fails with `invalid-arguments`. */
export function collection(text: string): Result<CollectionId> {
  return checked(collectionId, text, {
    code: 'invalid-arguments',
    message: 'Collection IDs must be canonical IDs: a letter, then letters, digits, _ or -.',
  });
}

/** A request ID operand (`receipt`, `retry`, `apply`) or --request. Fails with `invalid-request`. */
export function request(text: string): Result<RequestId> {
  return checked(requestId, text, { code: 'invalid-request', message: 'Request ID is invalid' });
}

/** --request; absent stays absent and a fresh ID is minted later. Fails with `invalid-request`. */
export function retains(flags: Pick<CommandFlags, 'request'>): Result<Retains> {
  if (flags.request === undefined) return success({});
  return mapped(request(flags.request), (id) => ({ request: id }));
}

/**
 * A FILE operand. Only an empty path fails here, with the text its read would give:
 * `source-unavailable`. It fails before the credential read, the server check or any send.
 */
export function sourceFile(text: string): Result<FilePath> {
  return checked(filePath, text, unreadableSource(text));
}

/**
 * --out; absent stays absent. An empty path fails with the text its write would give:
 * `output-unavailable`. It fails before the command runs, so nothing is sent or committed.
 */
export function writes(flags: Pick<CommandFlags, 'out'>): Result<Writes> {
  if (flags.out === undefined) return success({});
  return mapped(checked(filePath, flags.out, unwritableOutput(flags.out)), (path) => ({
    out: path,
  }));
}

/** A profile operand or --profile. Fails with `unknown-profile`. */
export function profile(text: string): Result<ProfileId> {
  return checked(profileId, text, {
    code: 'unknown-profile',
    message: `Unknown profile: ${text}`,
    recovery: 'Use build-spec@1.',
  });
}

/**
 * --server (the local service's default port when absent), then --workspace (the executable's
 * default when absent; an empty one is the current directory). Fails with `invalid-server`, before
 * the credential is read.
 */
export function serviceOptions(
  flags: Pick<CommandFlags, 'server' | 'workspace'>,
  defaults: CommandDefaults,
): Result<ServiceOptions> {
  const { server = defaultServer, workspace = defaults.workspace } = flags;
  return joined(origin(server), workspacePath(workspace), (address, directory) => ({
    server: address,
    workspace: directory,
  }));
}

/**
 * The origin the agent token may go to: an `http://127.0.0.1` origin, never a remote host. Fails
 * with `invalid-server`: text that is not a URL first, then a URL that is not a loopback origin.
 */
function origin(text: string): Result<LoopbackOrigin> {
  if (!URL.canParse(text))
    return failure({ code: 'invalid-server', message: 'Server URL is invalid' });
  return checked(loopbackOrigin, text, {
    code: 'invalid-server',
    message: 'Server must be an IPv4 loopback HTTP origin',
  });
}

/**
 * The directory holding the agent credential and the request journal. Every text is accepted: an
 * empty one is the current directory. Fails with `invalid-arguments` only if that were empty.
 */
function workspacePath(text: string): Result<FilePath> {
  return checked(filePath, directoryText(text), {
    code: 'invalid-arguments',
    message: 'Workspace must be a directory path.',
  });
}

/** --workspace as Node resolves it: `''` names the current directory, so it becomes `.`. */
function directoryText(text: string): string {
  if (text === '') return currentDirectory;
  return text;
}

/** --mode as given, or the default mode. */
function modeText(flags: Pick<CommandFlags, 'mode'>): string {
  return flags.mode ?? defaultMode;
}

/** A --section or --object ID. Fails with `invalid-arguments`. */
function scopeId<T>(
  parser: Parser<T>,
  text: string,
): Result<T> {
  return checked(parser, text, {
    code: 'invalid-arguments',
    message: 'Read scope IDs must be non-empty canonical IDs.',
  });
}

/** Whether `text` is one of the three change modes. */
function isChangeMode(text: string): text is ChangeMode {
  return Object.hasOwn(changeModes, text);
}
