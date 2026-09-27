/*
 * `read`'s text: the collection's DSL source under a revision comment, so the text stays fully
 * authorable. Pure. A partial read and kept manual geometry are named in comments above it.
 */
import type { ReadScope } from '../../contract/records/command.js';
import type { ManualTarget, Readout } from '../../contract/records/service-answers.js';

/** The notice printed above a section or object read. */
const partialNotice =
  '# Read-only partial context; referenced objects/views and manual geometry may be omitted. Read those IDs separately or use the full collection.\n';

/** The scope notice, the `# ID revision=N` comment and any manual-geometry note, then the source. */
export function sourceText(readout: Readout): string {
  return `${scopeNotice(readout.scope)}# ${readout.collection} revision=${readout.revision}${manualNote(readout.manual)}\n${readout.source}`;
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
