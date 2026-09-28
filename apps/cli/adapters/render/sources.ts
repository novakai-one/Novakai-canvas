/*
 * Why this file exists
 *
 * A render starts from `.canvas` text but can only draw a checked collection. Language turns the
 * text into a collection, and Model checks it. Export asks for the same jobs, plus printing a
 * collection back to text, through its own `Documents` shape and its own kind of mistake.
 *
 * This file answers both from Language and Model. A source is always read as a new collection,
 * never as a change to a saved one. Mistakes come back as values; nothing is read from disk.
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

/**
 * Gives core its Language and Model steps: parse text, turn it into a collection, check a
 * collection. Each step fails with Language's or Model's own findings.
 */
export function createRenderSources(language: Pick<Language, 'parse' | 'lower'>): RenderSources {
  return {
    parse: (source) => language.parse(source),
    lower: (source, resources) => lowerAsNew(language, source, resources),
    validate: (value) => validate(value),
  };
}

/**
 * Gives Export its way to read, print and parse collections, using `resolvedResources` for the
 * source's font, image and theme names. Export needs it to start, though render:png never uses it.
 * A mistake becomes Export's `invalid-input` (read, print) or `invalid-import` (parse).
 */
export function createExportDocuments(
  language: Pick<Language, 'lower' | 'print'>,
  resolvedResources: ResolvedResources,
): Documents {
  return {
    read: (value) => document(validate(value), 'invalid-input', 'collection'),
    print: (collection) => printed(language, collection),
    parse: (source) =>
      document(lowerAsNew(language, source, resolvedResources), 'invalid-import', 'source'),
  };
}

/**
 * `source` lowered as a new collection against `resources`, with no snapshot. Fails with
 * Language's `validation-failed` diagnostics.
 */
function lowerAsNew(
  language: Pick<Language, 'lower'>,
  source: string,
  resources: ResolvedResources,
): LanguageResult<Collection> {
  const lowered = language.lower({ source, mode: 'create', snapshot: null, resources });
  if (!lowered.ok) return lowered;
  return { ok: true, value: lowered.value.collection };
}

/** The Export code a refusal carries: `invalid-input` for read and print, `invalid-import` for parse. */
type DocumentCode = Extract<ExportDiagnostic['code'], 'invalid-input' | 'invalid-import'>;

/** A Model or Language refusal: `validation-failed` with at least one diagnostic. */
interface OwnerRefusal {
  readonly diagnostics: readonly [{ readonly message: string }, ...{ readonly message: string }[]];
}

/** What every refusal tells the caller to do. */
const recovery = 'Correct the named collection source and rerun render:png.';

/** The owner's collection, or its refusal as Export's `code` at `path`. */
function document(
  outcome: Result<Collection, OwnerRefusal>,
  code: DocumentCode,
  path: string,
): Result<Collection, ExportDiagnostic> {
  if (!outcome.ok) return refused(outcome.error, code, path);
  return outcome;
}

/** The collection as Language prints it whole. Fails with `invalid-input` at `source`. */
function printed(
  language: Pick<Language, 'print'>,
  collection: Collection,
): Result<string, ExportDiagnostic> {
  const readout = language.print({ collection, scope: { kind: 'all' } });
  if (!readout.ok) return refused(readout.error, 'invalid-input', 'source');
  return success(readout.value.source);
}

/** Export's diagnostic for an owner's refusal: `code` at `path`, with its first message. */
function refused(
  error: OwnerRefusal,
  code: DocumentCode,
  path: string,
): Result<never, ExportDiagnostic> {
  return { ok: false, error: { code, path, message: error.diagnostics[0].message, recovery } };
}
