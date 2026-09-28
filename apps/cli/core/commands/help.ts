/*
 * `canvas --help`: a title, every command's usage lines from the command table in table order, then
 * the notes on options, modes, read scopes and receipts. Pure; built once. Available before the
 * credential, any file or the service is touched.
 */
import { commandRows } from './table.js';

/** The first line. */
const title = 'Novakai Canvas — author collections with readable DSL';

/** The lines after the commands. */
const notes: readonly string[] = Object.freeze([
  'Options: --server URL --workspace DIR --request ID --out FILE',
  'Modes: create, replace, patch. Agents never need JSON coordinates.',
  'Read scopes return a non-authorable view envelope; referenced objects/views and manual geometry may be omitted.',
  'Use a full read when you need editable source. Patch/preview/apply remain the revision-checked editing workflow.',
  'A missing or uncertain receipt is not confirmation that an edit was saved.',
]);

/** The help text, with no trailing line break. */
export const usage = [title, '', ...commandRows().flatMap((row) => row.usage), '', ...notes].join(
  '\n',
);
