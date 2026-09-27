/*
 * Export documents: Export's documents port — Model validation and Language printing — and the
 * route's Markdown text from Export's formatter. Pure over the injected capabilities; compose
 * passes Model, Language and Export's rules from ServiceCapabilities. Every returned failure is an
 * Export refusal; the export route releases its lease and the caller owns the retry. A throw from
 * Language or the formatter is not caught; the HTTP server's `receive` answers it `unavailable`.
 */
import type { Collection, Language } from '../../contract/records/capabilities.js';
import type { ExportRules, ModelRules } from '../../contract/ports/capabilities.js';
import type {
  Documents,
  ExportResult,
  MarkdownScope,
} from '../../contract/records/export/export.js';
import { cancelledExport, exportRejection } from './faults.js';

/** The capabilities the documents port reads through. */
export interface DocumentOwners {
  readonly model: Pick<ModelRules, 'validate'>;
  readonly language: Pick<Language, 'print'>;
}

/**
 * The documents port: Model validates, Language prints whole collections; import is refused.
 * `read` fails with `invalid-input` at `collection`; `print` fails with `invalid-input` at
 * `source`; `parse` always fails with `invalid-import` at `source`.
 */
export function exportDocuments(owners: DocumentOwners): Documents {
  return {
    read: (value) => {
      const checked = owners.model.validate(value);
      return checked.ok
        ? checked
        : exportRejection('invalid-input', 'collection', 'Collection is invalid');
    },
    print: (collection) => printedSource(owners.language, collection),
    parse: () =>
      exportRejection('invalid-import', 'source', 'Import parsing is not part of browser export'),
  };
}

/**
 * Canonical DSL of the whole collection. Fails with `invalid-input` at `source` when Language
 * cannot print. A throw from Language is not caught.
 */
export function printedSource(
  language: Pick<Language, 'print'>,
  collection: Collection,
): ExportResult<string> {
  const printed = language.print({ collection, scope: { kind: 'all' } });
  if (!printed.ok)
    return exportRejection('invalid-input', 'source', 'Collection could not be printed');
  return { ok: true, value: printed.value.source };
}

/**
 * Markdown for one scope; cancellation is checked before and after formatting. Fails with
 * `cancelled` at `export` when the request aborted, and with `invalid-input` at `scope` when the
 * requested section does not exist. A throw from the formatter is not caught.
 */
export function markdownText(
  signal: AbortSignal,
  collection: Collection,
  scope: MarkdownScope,
  rules: Pick<ExportRules, 'formatMarkdown'>,
): ExportResult<string> {
  if (signal.aborted) return cancelledExport();
  const source = rules.formatMarkdown(collection, scope);
  if (source === undefined)
    return exportRejection('invalid-input', 'scope', 'The requested section does not exist');
  return markdownCompletion(source, signal);
}

/** The formatted text; fails with `cancelled` at `export` when the request aborted meanwhile. */
function markdownCompletion(
  source: string,
  signal: AbortSignal,
): ExportResult<string> {
  return signal.aborted ? cancelledExport() : { ok: true, value: source };
}
