import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace, serveWorkspace } from '../contract/compose.js';
import type { Result } from '../contract/errors.js';
import type { LocalServer } from '../contract/records/transport/server.js';
import type { WorkspaceSession } from '../contract/types.js';
/** Print stable diagnostic fields only. Credential values and raw request bodies are never logged. */
function report(result: Result<unknown>): void {
  if (result.ok) return;
  process.stderr.write(`${result.error.code}: ${result.error.message}\n${result.error.recovery}\n`);
  process.exitCode = 1;
}
/** Drain the listener before native owners; callers reconcile outstanding receipt IDs on restart. */
async function stop(
  server: LocalServer,
  workspace: WorkspaceSession,
): Promise<void> {
  report(await server.close());
  report(await workspace.close());
}
/** Node owns process signals. One shared shutdown promise makes SIGINT/SIGTERM races harmless. */
function shutdown(
  server: LocalServer,
  workspace: WorkspaceSession,
): void {
  let closing: Promise<void> | null = null;
  const close = (): void => {
    closing ??= stop(server, workspace);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
/** Startup arguments choose filesystem locations; diagram requests can never change them. */
async function main(): Promise<void> {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const args = parseArgs({
    options: {
      port: { type: 'string', default: '5174' },
      workspace: { type: 'string', default: resolve(root, '.local/workspace') },
      web: { type: 'string', default: resolve(root, 'apps/web/dist') },
    },
  });
  const port = Number(args.values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    process.stderr.write('Port must be an integer from 1024 through 65535.\n');
    process.exitCode = 1;
    return;
  }
  return start(root, resolve(args.values.workspace), resolve(args.values.web), port);
}
/** Real workspace initialization completes before the socket opens; failed socket startup closes native handles. */
async function start(
  root: string,
  directory: string,
  webRoot: string,
  port: number,
): Promise<void> {
  const workspace = await openWorkspace({
    directory,
    workspace: 'local',
    title: 'Canvas workspace',
    resourceRoot: resolve(root, 'resources'),
    tokenRoot: resolve(root, 'capability/design-system'),
    createdAt: Date.now(),
  });
  if (!workspace.ok) {
    report(workspace);
    return;
  }
  const server = await serveWorkspace(workspace.value, {
    port,
    webRoot,
    credentialFile: resolve(directory, 'agent-credential.json'),
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
void main().catch(() => {
  process.stderr.write('Canvas startup failed. Check the arguments and workspace permissions.\n');
  process.exitCode = 1;
});
