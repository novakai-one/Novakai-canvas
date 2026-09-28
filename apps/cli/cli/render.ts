/*
 * Why this file exists
 *
 * An agent needs to check what a diagram looks like, without a browser.
 * `pnpm render:png --collection states --out out/` draws a collection to image files.
 *
 * This file is that program. It hands the words to `runRender` and prints the result as JSON on
 * stdout. A typing mistake prints as lines on stderr instead, like `pnpm canvas`. Any failure
 * exits with 1. It never changes a saved collection.
 */
import { fileURLToPath } from 'node:url';
import type { CliFailure, RenderFailure, RenderReport, Result } from '../contract/index.js';
import { formatFailure, runRender } from '../contract/index.js';

/** The checkout this file ships in; every shipped theme, collection and wasm file is below it. */
const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Everything a render can come back with: its report, or why it failed. */
type RenderOutcome = Result<RenderReport, RenderFailure | CliFailure>;

/** Runs the typed render, prints what came back, and sets the exit code to 1 on a failure. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outcome = await runRender(argv, root);
  if (!outcome.ok) {
    process.exitCode = 1;
  }
  printOutcome(outcome);
}

/** Prints a typing mistake as lines on stderr, and anything else as JSON on stdout. */
function printOutcome(outcome: RenderOutcome): void {
  if (!outcome.ok && isTypingMistake(outcome.error)) {
    printFailure(outcome.error);
    return;
  }
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

/** Whether the render failed because its flags were typed wrong (`invalid-arguments`). */
function isTypingMistake(failure: RenderFailure | CliFailure): failure is CliFailure {
  return failure.code === 'invalid-arguments';
}

/** Prints the failure as lines on stderr, the same way `pnpm canvas` does. */
function printFailure(failure: CliFailure): void {
  const lines = formatFailure(failure);
  process.stderr.write(`${lines.join('\n')}\n`);
}

/** Prints what went wrong and sets the exit code to 1. Only a bug gets here: failures are values. */
function reportCrash(thrown: unknown): void {
  process.stderr.write(`${String(thrown)}\n`);
  process.exitCode = 1;
}

await main().catch(reportCrash);
