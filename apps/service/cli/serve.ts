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
import type { Result } from '../contract/errors.js';
import type { LocalServer } from '../contract/records/transport/server.js';
import type { WorkspaceSession } from '../contract/types.js';
import { hostPath, loopbackPort, type HostPath, type LoopbackPort } from '../contract/brands.js';
import { timestamp, workspaceId } from '../contract/schemas.js';

void main().catch(() => {
  process.stderr.write('Canvas startup failed. Check the arguments and workspace permissions.\n');
  process.exitCode = 1;
});

/**
 * Startup arguments choose filesystem locations; diagram requests can never change them. A port
 * outside 1024–65535 prints "Port must be an integer from 1024 through 65535." and exits 1.
 */
async function main(): Promise<void> {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const args = parseArgs({
    options: {
      port: { type: 'string', default: '5174' },
      workspace: { type: 'string', default: resolve(root, '.local/workspace') },
      web: { type: 'string', default: resolve(root, 'apps/web/dist') },
    },
  });
  const port = loopbackPort.safeParse(Number(args.values.port));
  if (!port.success) {
    process.stderr.write('Port must be an integer from 1024 through 65535.\n');
    process.exitCode = 1;
    return;
  }
  return start(root, hostPathAt(args.values.workspace), hostPathAt(args.values.web), port.data);
}

/**
 * Real workspace initialization completes before the socket opens; failed socket startup closes
 * the workspace. The workspace is `local`, created now when it is new.
 */
async function start(
  root: string,
  directory: HostPath,
  webRoot: HostPath,
  port: LoopbackPort,
): Promise<void> {
  const workspace = await openWorkspace({
    directory,
    workspace: workspaceId.parse('local'),
    title: 'Canvas workspace',
    resourceRoot: hostPathAt(root, 'resources'),
    tokenRoot: hostPathAt(root, 'capability/design-system'),
    createdAt: timestamp.parse(Date.now()),
  });
  if (!workspace.ok) {
    report(workspace);
    return;
  }
  const server = await serveWorkspace(workspace.value, {
    port,
    webRoot,
    credentialFile: hostPathAt(directory, 'agent-credential.json'),
  });
  return started(server, workspace.value);
}

/** Only the loopback URL and credential path are public startup information; the secret remains in its owner-only file. */
async function started(
  server: Result<LocalServer>,
  workspace: WorkspaceSession,
): Promise<void> {
  if (!server.ok) {
    report(server);
    report(await workspace.close());
    return;
  }
  process.stdout.write(`Canvas: ${server.value.url}\n`);
  shutdown(server.value, workspace);
}

/**
 * Node owns process signals. The first SIGINT or SIGTERM stops the server and workspace once; the
 * other signal is then ignored, and a repeated signal gets Node's default (the process ends).
 */
function shutdown(
  server: LocalServer,
  workspace: WorkspaceSession,
): void {
  void Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]).then(() =>
    stop(server, workspace),
  );
}

/** Drain the listener, then the workspace; callers reconcile outstanding receipt IDs on restart. */
async function stop(
  server: LocalServer,
  workspace: WorkspaceSession,
): Promise<void> {
  report(await server.close());
  report(await workspace.close());
}

/** Print stable diagnostic fields only. Credential values and raw request bodies are never logged. */
function report(result: Result<unknown>): void {
  if (result.ok) return;
  process.stderr.write(`${result.error.code}: ${result.error.message}\n${result.error.recovery}\n`);
  process.exitCode = 1;
}

/** The absolute host path of `segments`, resolved from the working directory. Never fails. */
function hostPathAt(...segments: readonly string[]): HostPath {
  return hostPath.parse(resolve(...segments));
}
