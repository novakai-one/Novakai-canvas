/*
 * Why this file exists
 *
 * A render starts from `.canvas` text but can only draw a checked collection. Language parses the
 * text and turns it into a collection (its `lower` step), and Model checks it. Export asks for the
 * same jobs, plus printing a collection back to text, through its own `Documents` shape and its
 * own kind of mistake.
 *
 * This file answers core and Export from Language and Model. A source is always read as a new
 * collection, never as a change to a saved one. Mistakes come back as values. Nothing touches disk.
 */
import { validate } from '@novakai/canvas-model';
import type { Result as LanguageResult } from '@novakai/canvas-language';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type {
  Collection,
  Documents,
  ExportDiagnostic,
  Language,
  ResolvedResources,
} from '../../contract/records/foreign.js';
import { success, type Result } from '../../contract/errors.js';

/** Export's code for a refusal: `invalid-input` for read and print, `invalid-import` for parse. */
type DocumentCode = Extract<ExportDiagnostic['code'], 'invalid-input' | 'invalid-import'>;

/** A Model or Language refusal: `validation-failed` with at least one diagnostic. */
interface OwnerRefusal {
  readonly diagnostics: readonly [{ readonly message: string }, ...{ readonly message: string }[]];
}

/** What every refusal tells the caller to do. */
const recovery = 'Correct the named collection source and rerun render:png.';

/**
 * Gives core its three steps: parse text (`parse`) and turn it into a new collection (`lower`)
 * with Language, then check a collection with Model (`validate`). Each fails with its owner's
 * findings.
 */
export function createRenderSources(language: Pick<Language, 'parse' | 'lower'>): RenderSources {
  return {
    parse: (source) => language.parse(source),
    lower: (source, resources) => lowerAsNew(language, source, resources),
    validate: (candidate) => validate(candidate),
  };
}

/**
 * Gives Export its `Documents`: `read` checks a collection (Model), `print` turns one into text,
 * and `parse` turns text into a new collection (Language's `lower`, with font, image and theme
 * names from `resolvedResources`). Export needs them to start; render:png never calls them.
 * Mistakes become Export's `invalid-input` (read, print) or `invalid-import` (parse).
 */
export function createExportDocuments(
  language: Pick<Language, 'lower' | 'print'>,
  resolvedResources: ResolvedResources,
): Documents {
  return {
    read: readForExport,
    print: (collection) => printForExport(language, collection),
    parse: (source) => parseForExport(language, source, resolvedResources),
  };
}

/** Turns the text into a new collection with Language, never a change to a saved one. */
function lowerAsNew(
  language: Pick<Language, 'lower'>,
  source: string,
  resources: ResolvedResources,
): LanguageResult<Collection> {
  const lowered = language.lower({ source, mode: 'create', snapshot: null, resources });
  if (!lowered.ok) {
    return lowered;
  }
  return success(lowered.value.collection);
}

/** Checks a collection with Model, for Export's `read`. */
function readForExport(candidate: unknown): Result<Collection, ExportDiagnostic> {
  const checked = validate(candidate);
  if (!checked.ok) {
    return exportRefusalFailure(checked.error, 'invalid-input', 'collection');
  }
  return success(checked.value);
}

/** Prints the whole collection as text with Language, for Export's `print`. */
function printForExport(
  language: Pick<Language, 'print'>,
  collection: Collection,
): Result<string, ExportDiagnostic> {
  const printed = language.print({ collection, scope: { kind: 'all' } });
  if (!printed.ok) {
    return exportRefusalFailure(printed.error, 'invalid-input', 'source');
  }
  return success(printed.value.source);
}

/** Turns text into a new collection with Language, for Export's `parse`. */
function parseForExport(
  language: Pick<Language, 'lower'>,
  source: string,
  resolvedResources: ResolvedResources,
): Result<Collection, ExportDiagnostic> {
  const lowered = lowerAsNew(language, source, resolvedResources);
  if (!lowered.ok) {
    return exportRefusalFailure(lowered.error, 'invalid-import', 'source');
  }
  return success(lowered.value);
}

/** Makes Export's mistake from a Model or Language refusal, with the refusal's first message. */
function exportRefusalFailure(
  refusal: OwnerRefusal,
  code: DocumentCode,
  path: string,
): Result<never, ExportDiagnostic> {
  const firstMessage = refusal.diagnostics[0].message;
  const diagnostic: ExportDiagnostic = { code, path, message: firstMessage, recovery };
  return { ok: false, error: diagnostic };
}
