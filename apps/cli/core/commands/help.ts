/*
 * Why this file exists
 *
 * An agent that doesn't know the commands types `pnpm canvas --help`. It should get every command
 * and how to type it, such as `canvas read ID [--section ID | --object ID] [--out FILE]`.
 *
 * This file writes that text once, from the command rows in `table.ts`, so the help and the
 * commands can't drift apart. It never reads a credential or a file, or contacts the service.
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
const commandUsage: readonly string[] = commandRows().flatMap(usageLinesOf);

/** The whole `--help` text: a title, every command's lines, then the notes. No final line break. */
export const helpText = [title, blankLine, ...commandUsage, blankLine, ...notes].join('\n');

/** One command's lines in `canvas --help`, as its table row gives them. */
function usageLinesOf(row: CommandRow): readonly string[] {
  return row.usage;
}
