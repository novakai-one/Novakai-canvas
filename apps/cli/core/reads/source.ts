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
const partialReadNotice =
  '# Read-only partial context; referenced objects/views and manual geometry may be omitted. Read those IDs separately or use the full collection.';

/**
 * Writes `read`'s answer as the text to print: `#` comment lines on top, then the source as sent.
 * The comments name the collection and revision, a partial read, and any hand-placed objects.
 */
export function formatReadAnswer(answer: ReadAnswer): string {
  const partialReadLines = partialReadNoticeLines(answer.scope);
  const revisionLine = `# ${answer.collection} revision=${answer.revision}`;
  const manualLines = manualNoteLines(answer.manual);
  const lines = [...partialReadLines, revisionLine, ...manualLines, answer.source];
  return lines.join('\n');
}

/** Writes the partial-read notice for a section or object read, and nothing for a whole one. */
function partialReadNoticeLines(scope: ReadScope): readonly string[] {
  if (scope.kind === 'all') {
    return [];
  }
  return [partialReadNotice];
}

/**
 * Writes a note counting the objects and wires placed by hand, or nothing when there are none.
 * `replace` keeps them where they are, so the note says how to let layout move them again.
 */
function manualNoteLines(manualTargets: readonly ManualTarget[]): readonly string[] {
  if (manualTargets.length === 0) {
    return [];
  }
  const manualNote = `# manual geometry: ${manualTargets.length} target(s) — replace preserves these; reset layout @section / reset route @section/@wire to reflow`;
  return [manualNote];
}
