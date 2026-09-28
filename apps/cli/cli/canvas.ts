/*
 * Why this file exists
 *
 * AI agents can't click a canvas, so they type commands: `pnpm canvas read my-diagram`. Something
 * has to take those words from the terminal and print what comes back.
 *
 * This file is that program. It hands the words to `runCanvas`, prints the answer on stdout or the
 * failure on stderr, and exits with 1 on any failure. It never prints the agent's token or a
 * request's contents.
 */
import { fileURLToPath } from 'node:url';
import type { CliFailure, Result } from '../contract/index.js';
import { formatFailure, runCanvas } from '../contract/index.js';

/** The workspace a command uses when given no `--workspace`: `.local/workspace` in this checkout. */
const defaultWorkspace = fileURLToPath(new URL('../../../.local/workspace', import.meta.url));

/** Runs the typed command, prints what came back, and sets the exit code to 1 on a failure. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outcome = await runCanvas(argv, defaultWorkspace);
  if (!outcome.ok) {
    process.exitCode = 1;
  }
  printOutcome(outcome);
}

/** Prints the command's text on stdout, or its failure on stderr. */
function printOutcome(outcome: Result<string>): void {
  if (!outcome.ok) {
    printFailure(outcome.error);
    return;
  }
  process.stdout.write(`${outcome.value}\n`);
}

/** Prints the failure as lines on stderr. */
function printFailure(failure: CliFailure): void {
  const lines = formatFailure(failure);
  process.stderr.write(`${lines.join('\n')}\n`);
}

/** Says printing failed and sets the exit code to 1. Only a throw while printing gets here. */
function reportPrintingCrash(): void {
  process.stderr.write('CLI failed. Preserve the request ID and check its receipt.\n');
  process.exitCode = 1;
}

await main().catch(reportPrintingCrash);
