/*
 * Why this file exists
 *
 * AI agents can't click a canvas, so they type commands: `pnpm canvas read my-diagram`. Something
 * has to take those words from the terminal and print what comes back.
 *
 * This file is that program. It hands the words to `runCli`, prints the answer on stdout or the
 * failure on stderr, and exits with 1 on any failure. It never prints the agent's token or a
 * request's contents.
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
