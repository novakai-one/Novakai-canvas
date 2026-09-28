/*
 * Why this file exists
 *
 * Export (the capability) makes SVG and PNG files, but it can't check a collection or write DSL by
 * itself. It asks a "documents" helper that the service supplies. The DSL and Markdown exports
 * need the same text, for example the `.canvas` file of `my-diagram` at revision 3.
 *
 * This file builds that helper from Model and Language, and writes a collection as DSL or Markdown.
 * Each answers an Export `Result` (mistakes made in faults.ts). It never reads an import: that is
 * always refused. A throw from Language or the Markdown formatter is not caught here.
 */
import type {
  Collection,
  Documents,
  ExportResult,
  Language,
  MarkdownScope,
} from '../../contract/records/capability-types.js';
import type { ExportRules, ModelRules } from '../../contract/ports/capabilities.js';
import { cancelledFailure, exportFailure } from './faults.js';

/** What the documents helper uses: Model to check a collection, Language to write its DSL. */
export interface DocumentDependencies {
  /** Model's check of a whole collection. */
  readonly model: Pick<ModelRules, 'validate'>;
  /** Language, which writes a collection as DSL text. */
  readonly language: Pick<Language, 'print'>;
}

/**
 * Builds the documents helper Export asks for. Its `read` checks a collection with Model, its
 * `print` writes the whole collection as DSL, and its `parse` is always refused.
 * Mistakes: `invalid-input` at `collection` or `source`, and `invalid-import` from `parse`.
 */
export function createDocumentsForExport(dependencies: DocumentDependencies): Documents {
  return {
    read: (value) => {
      const checked = dependencies.model.validate(value);
      return checked.ok
        ? checked
        : exportFailure('invalid-input', 'collection', 'Collection is invalid');
    },
    print: (collection) => printCollectionDsl(dependencies.language, collection),
    parse: () =>
      exportFailure('invalid-import', 'source', 'Import parsing is not part of browser export'),
  };
}

/**
 * Writes the whole collection as DSL text. Fails with `invalid-input` at `source` when Language
 * can't print it. A throw from Language is not caught.
 */
export function printCollectionDsl(
  language: Pick<Language, 'print'>,
  collection: Collection,
): ExportResult<string> {
  const printed = language.print({ collection, scope: { kind: 'all' } });
  if (!printed.ok)
    return exportFailure('invalid-input', 'source', 'Collection could not be printed');
  return { ok: true, value: printed.value.source };
}

/**
 * Writes the collection, or the one section `scope` names, as Markdown text.
 * Fails with `cancelled` at `export` when the export was stopped before or after writing, and
 * `invalid-input` at `scope` when the section doesn't exist. A throw from the formatter is not
 * caught.
 */
export function formatCollectionMarkdown(
  signal: AbortSignal,
  collection: Collection,
  scope: MarkdownScope,
  rules: Pick<ExportRules, 'formatMarkdown'>,
): ExportResult<string> {
  if (signal.aborted) return cancelledFailure();
  const source = rules.formatMarkdown(collection, scope);
  if (source === undefined)
    return exportFailure('invalid-input', 'scope', 'The requested section does not exist');
  return markdownCompletion(source, signal);
}

/** The formatted text; fails with `cancelled` at `export` when the request aborted meanwhile. */
function markdownCompletion(
  source: string,
  signal: AbortSignal,
): ExportResult<string> {
  return signal.aborted ? cancelledFailure() : { ok: true, value: source };
}
