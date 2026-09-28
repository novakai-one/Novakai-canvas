/*
 * Why this file exists
 *
 * Export (the capability) makes SVG and PNG files, but it can't check a collection or write DSL by
 * itself. It asks a "documents" helper that the service supplies. The DSL and Markdown exports
 * (text.ts) need text too: the `.canvas` DSL, or Markdown, of `my-diagram` at revision 3.
 *
 * This file builds that helper from Model and Language, and writes a collection as DSL or Markdown.
 * Each answers an Export `Result` (mistakes made in faults.ts). Export can ask the helper to read
 * DSL back in (`parse`); that is always refused. A throw while writing the text isn't caught.
 */
import type {
  Collection,
  Documents,
  ExportResult,
  Language,
  MarkdownScope,
} from '../../contract/records/capability-types.js';
import type { ExportRules, ModelRules } from '../../contract/ports/capabilities.js';
import { success } from '../../contract/errors.js';
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
    read: (candidate) => checkCollection(dependencies.model, candidate),
    print: (collection) => printCollectionDsl(dependencies.language, collection),
    parse: () => importNotSupportedFailure(),
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
  if (!printed.ok) {
    return unprintableCollectionFailure();
  }
  const dsl = printed.value.source;
  return success(dsl);
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
  if (signal.aborted) {
    return cancelledFailure();
  }
  const markdown = rules.formatMarkdown(collection, scope);
  if (markdown === undefined) {
    return missingSectionFailure();
  }
  return keepUnlessStopped(markdown, signal);
}

/** Has Model check a collection, and refuses one Model doesn't accept. */
function checkCollection(
  model: Pick<ModelRules, 'validate'>,
  candidate: unknown,
): ExportResult<Collection> {
  const checked = model.validate(candidate);
  if (!checked.ok) {
    return invalidCollectionFailure();
  }
  return checked;
}

/** Gives back the written Markdown, unless the export was stopped while it was being written. */
function keepUnlessStopped(
  markdown: string,
  signal: AbortSignal,
): ExportResult<string> {
  if (signal.aborted) {
    return cancelledFailure();
  }
  return success(markdown);
}

/** Makes the mistake for a collection Model refuses: `invalid-input` at `collection`. */
function invalidCollectionFailure(): ExportResult<never> {
  return exportFailure('invalid-input', 'collection', 'Collection is invalid');
}

/** Makes the mistake for a collection Language can't print: `invalid-input` at `source`. */
function unprintableCollectionFailure(): ExportResult<never> {
  return exportFailure('invalid-input', 'source', 'Collection could not be printed');
}

/** Makes the mistake for a Markdown section that doesn't exist: `invalid-input` at `scope`. */
function missingSectionFailure(): ExportResult<never> {
  return exportFailure('invalid-input', 'scope', 'The requested section does not exist');
}

/** Makes the mistake for reading DSL back in, which an export never does: `invalid-import`. */
function importNotSupportedFailure(): ExportResult<never> {
  return exportFailure('invalid-import', 'source', 'Import parsing is not part of browser export');
}
