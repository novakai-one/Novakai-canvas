/*
 * Why this file exists
 *
 * Someone starts the service by typing `pnpm dev --port 5174 --workspace ./my-workspace`. Those
 * words have to become a running service that stops cleanly on Ctrl-C.
 *
 * This file checks the port (1024 to 65535) and the folder paths, opens the workspace (always
 * called `local`), serves it at `http://127.0.0.1:<port>` and prints that address. On Ctrl-C or
 * SIGTERM it closes the server, then the workspace.
 *
 * It never prints a secret or a request body.
 */
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace, serveWorkspace } from '../contract/compose.js';
import type { Diagnostic, Result } from '../contract/errors.js';
import type { LocalServer, ServerOptions } from '../contract/records/transport/server.js';
import type { WorkspaceOptions } from '../contract/records/workspace/startup.js';
import type { WorkspaceSession } from '../contract/types.js';
import { hostPath, loopbackPort, type HostPath, type LoopbackPort } from '../contract/brands.js';
import { timestamp, workspaceId } from '../contract/schemas.js';

void main().catch(reportStartupCrash);

/** The three start-up flags as typed, with the usual value filled in for any left out. */
interface StartupFlags {
  /** The port as typed; `main` checks it. */
  readonly port: string;
  /** The workspace folder as typed. */
  readonly workspace: string;
  /** The folder of the built web app, as typed. */
  readonly web: string;
}

/** Checks the start-up flags, then starts the service; only these flags ever choose folders. */
async function main(): Promise<void> {
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const flags = readStartupFlags(repositoryRoot);
  const port = loopbackPort.safeParse(Number(flags.port));
  if (!port.success) {
    reportInvalidPort();
    return;
  }
  const workspaceFolder = hostPathAt(flags.workspace);
  const webRoot = hostPathAt(flags.web);
  return start(repositoryRoot, workspaceFolder, webRoot, port.data);
}

/** Reads `--port`, `--workspace` and `--web` from the command line; an unknown flag throws. */
function readStartupFlags(repositoryRoot: string): StartupFlags {
  const commandLine = parseArgs({
    options: {
      port: { type: 'string', default: '5174' },
      workspace: { type: 'string', default: resolve(repositoryRoot, '.local/workspace') },
      web: { type: 'string', default: resolve(repositoryRoot, 'apps/web/dist') },
    },
  });
  return commandLine.values;
}

/** Opens the `local` workspace in `directory` (creating it when new), then serves it. */
async function start(
  repositoryRoot: string,
  directory: HostPath,
  webRoot: HostPath,
  port: LoopbackPort,
): Promise<void> {
  const workspaceOptions = localWorkspaceOptions(repositoryRoot, directory);
  const workspace = await openWorkspace(workspaceOptions);
  if (!workspace.ok) {
    printDiagnostic(workspace.error);
    return;
  }
  const serverOptions = localServerOptions(directory, webRoot, port);
  return serve(workspace.value, serverOptions);
}

/** Builds the options that open the workspace in `directory` as `local`. */
function localWorkspaceOptions(
  repositoryRoot: string,
  directory: HostPath,
): WorkspaceOptions {
  return {
    directory,
    workspace: workspaceId.parse('local'),
    title: 'Canvas workspace',
    resourceRoot: hostPathAt(repositoryRoot, 'resources'),
    tokenRoot: hostPathAt(repositoryRoot, 'capability/design-system'),
    createdAt: timestamp.parse(Date.now()),
  };
}

/** Builds the server's options; the CLI's token file sits in the workspace folder. */
function localServerOptions(
  directory: HostPath,
  webRoot: HostPath,
  port: LoopbackPort,
): ServerOptions {
  const credentialFile = hostPathAt(directory, 'agent-credential.json');
  return { port, webRoot, credentialFile };
}

/** Serves the open workspace and prints its address, or reports the failure and closes it. */
async function serve(
  workspace: WorkspaceSession,
  serverOptions: ServerOptions,
): Promise<void> {
  const server = await serveWorkspace(workspace, serverOptions);
  if (!server.ok) {
    printDiagnostic(server.error);
    const closed = await workspace.close();
    reportIfFailed(closed);
    return;
  }
  // Only the address is printed; the secret stays in its owner-only file.
  process.stdout.write(`Canvas: ${server.value.url}\n`);
  stopOnSignal(server.value, workspace);
}

/** Stops the server and the workspace once, on the first Ctrl-C (SIGINT) or SIGTERM. */
function stopOnSignal(
  server: LocalServer,
  workspace: WorkspaceSession,
): void {
  // After the first signal the other one is ignored; a repeated signal gets Node's default (exit).
  const firstSignal = Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
  void firstSignal.then(() => stop(server, workspace));
}

/** Closes the server, then the workspace, reporting either failure. */
async function stop(
  server: LocalServer,
  workspace: WorkspaceSession,
): Promise<void> {
  const serverClosed = await server.close();
  reportIfFailed(serverClosed);
  const workspaceClosed = await workspace.close();
  reportIfFailed(workspaceClosed);
}

/** Prints the mistake when `outcome` failed; does nothing when it worked. */
function reportIfFailed(outcome: Result<unknown>): void {
  if (!outcome.ok) {
    printDiagnostic(outcome.error);
  }
}

/** Prints a mistake's code, message and advice, and marks the process as failed. */
function printDiagnostic(diagnostic: Diagnostic): void {
  process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n${diagnostic.recovery}\n`);
  process.exitCode = 1;
}

/** Prints the port mistake, and marks the process as failed. */
function reportInvalidPort(): void {
  process.stderr.write('Port must be an integer from 1024 through 65535.\n');
  process.exitCode = 1;
}

/** Prints the one line shown when start-up throws, and marks the process as failed. */
function reportStartupCrash(): void {
  process.stderr.write('Canvas startup failed. Check the arguments and workspace permissions.\n');
  process.exitCode = 1;
}

/** Joins `segments` into an absolute host path, resolved from the working directory. */
function hostPathAt(...segments: readonly string[]): HostPath {
  return hostPath.parse(resolve(...segments));
}
