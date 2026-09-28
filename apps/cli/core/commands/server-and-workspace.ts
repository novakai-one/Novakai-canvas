/*
 * Why this file exists
 *
 * Every service command carries the agent's access token to the local Canvas service. In
 * `pnpm canvas list --server http://127.0.0.1:5174 --workspace plans`, `--server` says where the
 * service runs, and `--workspace` names the folder that holds the token and the saved requests.
 *
 * This file checks those two, and fills in the usual ones when they are left out. It refuses any
 * server that isn't on this machine, so the token is never sent anywhere else. It never contacts
 * the service.
 */
import { filePath, loopbackOrigin } from '../../contract/brands.js';
import type { FilePath, LoopbackOrigin } from '../../contract/brands.js';
import type { ServerAndWorkspace } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import type { FlagTextAsTyped } from './flags.js';

/** The service's address when `--server` is left out: the local service's usual port. */
const defaultServer = 'http://127.0.0.1:5174';

/** The folder an empty `--workspace` means. Node reads `''` and `.` as the same folder. */
const currentFolder = '.';

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
  const serverText = flags.server ?? defaultServer;
  const server = checkServer(serverText);
  if (!server.ok) {
    return server;
  }
  const workspace = chooseWorkspace(flags.workspace, defaultWorkspace);
  if (!workspace.ok) {
    return workspace;
  }
  return success({ server: server.value, workspace: workspace.value });
}

/** Checks the server's address is plain `http://127.0.0.1`, with or without a port. */
function checkServer(serverText: string): Result<LoopbackOrigin> {
  if (!URL.canParse(serverText)) {
    return badServerAddressFailure();
  }
  const server = loopbackOrigin.safeParse(serverText);
  if (!server.success) {
    return notPlainLoopbackServerFailure();
  }
  return success(server.data);
}

/** Checks the typed `--workspace`, or uses `defaultWorkspace` when it wasn't typed. */
function chooseWorkspace(
  typedWorkspace: string | undefined,
  defaultWorkspace: FilePath,
): Result<FilePath> {
  if (typedWorkspace === undefined) {
    return success(defaultWorkspace);
  }
  return checkWorkspace(typedWorkspace);
}

/** Checks the `--workspace` folder path, where an empty one means the current folder. */
function checkWorkspace(workspaceText: string): Result<FilePath> {
  const folderText = fillEmptyWorkspace(workspaceText);
  const workspace = filePath.safeParse(folderText);
  if (!workspace.success) {
    return badWorkspaceFailure();
  }
  return success(workspace.data);
}

/** Turns an empty `--workspace` into `.`, the current folder, and keeps any other text as typed. */
function fillEmptyWorkspace(workspaceText: string): string {
  if (workspaceText === '') {
    return currentFolder;
  }
  return workspaceText;
}

/** Makes the mistake for a `--server` that isn't a web address at all (`invalid-server`). */
function badServerAddressFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-server', message: 'Server URL is invalid' });
}

/**
 * Makes the mistake for a `--server` that isn't plain `http://127.0.0.1:PORT`, such as
 * `http://example.com` or `http://localhost:5174` (`invalid-server`).
 */
function notPlainLoopbackServerFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-server',
    message: 'Server must be an IPv4 loopback HTTP origin',
  });
}

/**
 * Makes the mistake for a `--workspace` that isn't a folder path (`invalid-arguments`). It can't
 * happen today: an empty `--workspace` becomes `.` first.
 */
function badWorkspaceFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message: 'Workspace must be a directory path.' });
}
