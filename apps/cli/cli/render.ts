/*
 * `pnpm render:png`: argv → runRender. A render's result prints as JSON on stdout; an argument
 * failure prints as lines on stderr, like `pnpm canvas`. Any failure exits 1. Read-only: no stored
 * collection is changed, so the caller corrects the input and runs it again.
 */
import { fileURLToPath } from 'node:url';
import type { CliFailure, RenderFailure, RenderReport, Result } from '../contract/index.js';
import { formatFailure, runRender } from '../contract/index.js';

/** The checkout this file ships in; every shipped theme, collection and wasm file is below it. */
const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Run one render, print its outcome and set the exit code. */
async function main(): Promise<void> {
  const result = await runRender(process.argv.slice(2), root);
  if (!result.ok) process.exitCode = 1;
  print(result);
}

/** An argument failure as lines on stderr; any other outcome as JSON on stdout. */
function print(result: Result<RenderReport, RenderFailure | CliFailure>): void {
  if (!result.ok && result.error.code === 'invalid-arguments') {
    process.stderr.write(`${formatFailure(result.error).join('\n')}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/** A temporary-directory failure rejects with its OS error: print it and exit 1. */
await main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
