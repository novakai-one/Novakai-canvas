/*
 * DSL to collections and back for one headless render. The environment's sources port: Language
 * parses and lowers a source as a new collection with no snapshot, and Model checks a collection.
 * Export's documents port, which Export reads, prints and parses collections through: Model
 * validates, Language prints and lowers the same way. Only bundle exports call the documents port;
 * render:png writes SVG and PNG sections, so today nothing does. Pure. A refusal is returned,
 * never thrown: the sources port returns the owner's diagnostics, the documents port Export's own
 * diagnostic. The caller fixes the source and reruns.
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
 * The sources port over `language` and Model. Builds nothing and cannot fail; `parse` fails with
 * Language's diagnostics, `lower` as {@link lowerAsNew}, `validate` with Model's diagnostics.
 */
export function createRenderSources(language: Pick<Language, 'parse' | 'lower'>): RenderSources {
  return {
    parse: (source) => language.parse(source),
    lower: (source, resources) => lowerAsNew(language, source, resources),
    validate: (value) => validate(value),
  };
}

/**
 * Export's documents port over `language` and `pins`. Export's diagnostic carries the owner's
 * first message: read → `invalid-input` at `collection`, print → `invalid-input` at `source`,
 * parse → `invalid-import` at `source`.
 */
export function exportDocuments(
  language: Pick<Language, 'lower' | 'print'>,
  pins: ResolvedResources,
): Documents {
  return {
    read: (value) => document(validate(value), 'invalid-input', 'collection'),
    print: (collection) => printed(language, collection),
    parse: (source) => document(lowerAsNew(language, source, pins), 'invalid-import', 'source'),
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
