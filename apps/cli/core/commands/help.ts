/*
 * `canvas --help`: a title, every command's usage lines in the command table's order, then the
 * notes on options, modes, read scopes and receipts. Pure; built once. Printed before the
 * credential, any file or the service is touched.
 */
import { commandRows } from './table.js';
import type { CommandRow } from './table.js';

/** The first line. */
const title = 'Novakai Canvas — author collections with readable DSL';

/** The line between the title, the commands and the notes. */
const blankLine = '';

/** The lines after the commands. */
const notes: readonly string[] = Object.freeze([
  'Options: --server URL --workspace DIR --request ID --out FILE',
  'Modes: create, replace, patch. Agents never need JSON coordinates.',
  'Read scopes return a non-authorable view envelope; referenced objects/views and manual geometry may be omitted.',
  'Use a full read when you need editable source. Patch/preview/apply remain the revision-checked editing workflow.',
  'A missing or uncertain receipt is not confirmation that an edit was saved.',
]);

/** Every command's usage lines, in the command table's order. */
const commandUsage: readonly string[] = commandRows().flatMap(listUsageLines);

/** The help text: the title, the commands, then the notes, with no trailing line break. */
export const helpText = [title, blankLine, ...commandUsage, blankLine, ...notes].join('\n');

/** One command's lines in `canvas --help`, as its table row gives them. */
function listUsageLines(row: CommandRow): readonly string[] {
  return row.usage;
}
