import { fileURLToPath } from 'node:url';
import { formatFailure, runCli } from '../contract/index.js';
/** The executable reports one readable outcome and exit status. No credentials or request envelopes are logged. */
async function main(): Promise<void> {
  const workspace = fileURLToPath(new URL('../../../.local/workspace', import.meta.url));
  const result = await runCli(process.argv.slice(2), workspace);
  if (!result.ok) {
    process.stderr.write(`${formatFailure(result.error).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${result.value}\n`);
}
// Last resort only: runCli never rejects, so just a throw while printing reaches this line.
void main().catch(() => {
  process.stderr.write('CLI failed. Preserve the request ID and check its receipt.\n');
  process.exitCode = 1;
});
