/*
 * `pnpm canvas`: argv → runCli. A command's text prints on stdout; a failure prints as lines on
 * stderr. Any failure exits 1. No credential or request envelope is ever printed. After a sent
 * request the caller recovers with `canvas receipt ID`, then `canvas retry ID`.
 */
import { fileURLToPath } from 'node:url';
import type { Result } from '../contract/index.js';
import { formatFailure, runCli } from '../contract/index.js';

/** The workspace a command uses when given no `--workspace`: `.local/workspace` in this checkout. */
const defaultWorkspace = fileURLToPath(new URL('../../../.local/workspace', import.meta.url));

/** Run one command, print its outcome and set the exit code. */
async function main(): Promise<void> {
  const outcome = await runCli(process.argv.slice(2), defaultWorkspace);
  if (!outcome.ok) process.exitCode = 1;
  print(outcome);
}

/** A failure as lines on stderr; the command's text on stdout. */
function print(outcome: Result<string>): void {
  if (!outcome.ok) {
    process.stderr.write(`${formatFailure(outcome.error).join('\n')}\n`);
    return;
  }
  process.stdout.write(`${outcome.value}\n`);
}

/** runCli returns every failure as a value; only a throw while printing reaches this catch. */
await main().catch(() => {
  process.stderr.write('CLI failed. Preserve the request ID and check its receipt.\n');
  process.exitCode = 1;
});
