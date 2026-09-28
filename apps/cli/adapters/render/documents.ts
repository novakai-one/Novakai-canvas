/*
 * DSL to collections and back for one headless render. Language lowers a source as a new
 * collection with no snapshot: the environment's `lower`, and the `parse` of the documents port
 * Export reads, prints and parses collections through. For that port Model validates and Language
 * prints. Only bundle exports call the documents port; render:png writes SVG and PNG sections, so
 * today nothing does. Pure. A refusal is returned, never thrown: `lower` returns Language's
 * diagnostics, the documents port Export's own diagnostic. The caller fixes the source and reruns.
 */
import { validate } from '@novakai/canvas-model';
import type { Result as LanguageResult } from '@novakai/canvas-language';
import type { Diagnostic as ExportDiagnostic } from '@novakai/canvas-export';
import type { RenderEnvironment } from '../../contract/ports/render.js';
import type {
  Collection,
  Documents,
  Language,
  ResolvedResources,
} from '../../contract/records/foreign.js';
import { success, type Result } from '../../contract/errors.js';

/** The environment's lowering. */
export type Lowering = Pick<RenderEnvironment, 'lower'>;

/** Lowering over `language`. Builds nothing and cannot fail; `lower` fails as {@link lowerAsNew}. */
export function createLowering(language: Pick<Language, 'lower'>): Lowering {
  return { lower: (source, resources) => lowerAsNew(language, source, resources) };
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
