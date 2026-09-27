/*
 * `pnpm canvas`: argv → runCli. The answer prints on stdout; a failure prints as lines on stderr
 * and exits 1. No credential or request envelope is printed. Recovery after a sent request is
 * `canvas receipt ID`, then `canvas retry ID`.
 */
import { fileURLToPath } from 'node:url';
import type { Result } from '../contract/index.js';
import { formatFailure, runCli } from '../contract/index.js';

/** The workspace used when no --workspace is given: `.local/workspace` in this checkout. */
const defaultWorkspace = fileURLToPath(new URL('../../../.local/workspace', import.meta.url));

/** Run one command, print its outcome and set the exit code. */
async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), defaultWorkspace);
  if (!result.ok) process.exitCode = 1;
  print(result);
}

/** A failure as lines on stderr; an answer on stdout. */
function print(result: Result<string>): void {
  if (!result.ok) {
    process.stderr.write(`${formatFailure(result.error).join('\n')}\n`);
    return;
  }
  process.stdout.write(`${result.value}\n`);
}

/** runCli never rejects, so only a throw while printing reaches this: one fixed line, exit 1. */
await main().catch(() => {
  process.stderr.write('CLI failed. Preserve the request ID and check its receipt.\n');
  process.exitCode = 1;
});
