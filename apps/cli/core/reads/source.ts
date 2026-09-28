/*
 * Why this file exists
 *
 * An agent reads a collection to edit it, then sends it back with `replace --revision N`. So the
 * text must stay `.canvas` text it can edit, and still say which revision it came from.
 * `pnpm canvas read my-diagram` prints `# my-diagram revision=3`, then the source.
 *
 * This file writes that text. It adds a comment line on top when only a section or object was
 * read, and when some objects were placed by hand. It never changes the source itself.
 */
import type { ReadScope } from '../../contract/records/command.js';
import type { ManualTarget, ReadAnswer } from '../../contract/records/service-answers.js';

/** The notice printed above a section or object read. */
const partialNotice =
  '# Read-only partial context; referenced objects/views and manual geometry may be omitted. Read those IDs separately or use the full collection.\n';

/**
 * Writes `read`'s answer as the text to print: `#` comment lines on top, then the source as sent.
 * The comments name the collection and revision, a partial read, and any hand-placed objects.
 */
export function formatReadAnswer(answer: ReadAnswer): string {
  return `${scopeNotice(answer.scope)}# ${answer.collection} revision=${answer.revision}${manualNote(answer.manual)}\n${answer.source}`;
}

/** Nothing for a whole-collection read; the partial-context notice otherwise. */
function scopeNotice(scope: ReadScope): string {
  if (scope.kind === 'all') return '';
  return partialNotice;
}

/** Human geometry survives matching replacements; agents reset it explicitly when reflow is wanted. */
function manualNote(manual: readonly ManualTarget[]): string {
  if (manual.length === 0) return '';
  return `\n# manual geometry: ${manual.length} target(s) — replace preserves these; reset layout @section / reset route @section/@wire to reflow`;
}
