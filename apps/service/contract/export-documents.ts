/*
 * Export document wiring: the capability values the export route needs — Model validation,
 * Language printing and Export's Markdown formatter — composed into Export's documents port and
 * the route's Markdown text. They live at the contract root because app core never imports
 * capabilities; the pure export rules stay in core/export behind contract/api.js.
 */
import { validate } from '@novakai/canvas-model';
import { formatMarkdown } from '@novakai/canvas-export';
import { cancelledExport, exportRejection } from './api.js';
import type { Collection, Language } from './records/capabilities.js';
import type { Documents, ExportResult, MarkdownScope } from './records/export/export.js';

/** The documents port: Model validates, Language prints whole collections; import is refused. */
export function exportDocuments(language: Pick<Language, 'print'>): Documents {
  return {
    read: (value) => {
      const checked = validate(value);
      return checked.ok
        ? checked
        : exportRejection('invalid-input', 'collection', 'Collection is invalid');
    },
    print: (collection) => {
      const printed = language.print({ collection, scope: { kind: 'all' } });
      return printed.ok
        ? { ok: true, value: printed.value.source }
        : exportRejection('invalid-input', 'source', 'Collection could not be printed');
    },
    parse: () =>
      exportRejection('invalid-import', 'source', 'Import parsing is not part of browser export'),
  };
}

/** Markdown for one scope; cancellation is checked before and after formatting. */
export function markdownText(
  signal: AbortSignal,
  collection: Collection,
  scope: MarkdownScope,
): ExportResult<string> {
  if (signal.aborted) return cancelledExport();
  const source = formatMarkdown(collection, scope);
  if (source === undefined)
    return exportRejection('invalid-input', 'scope', 'The requested section does not exist');
  return markdownCompletion(source, signal);
}

/** The formatted text, unless the request aborted while it was formatted. */
function markdownCompletion(
  source: string,
  signal: AbortSignal,
): ExportResult<string> {
  return signal.aborted ? cancelledExport() : { ok: true, value: source };
}
