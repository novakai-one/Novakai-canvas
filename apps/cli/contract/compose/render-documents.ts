/*
 * The documents port Export reads, prints and parses collections through during one headless
 * render. Only bundle exports call it; render:png writes SVG and PNG sections, so today nothing
 * does. Model validates, Language prints and lowers against the render's pins. Pure. A refusal is
 * returned as Export's own diagnostic, never thrown; the caller fixes the source and reruns.
 */
import { validate } from '@novakai/canvas-model';
import type { Diagnostic as ExportDiagnostic } from '@novakai/canvas-export';
import type { Collection, Documents, Language, ResolvedResources } from '../records/foreign.js';
import { success, type Result } from '../errors.js';
import { lowerAsNew } from './language.js';

/** The Export code a refusal carries: `invalid-input` for read and print, `invalid-import` for parse. */
type DocumentCode = Extract<ExportDiagnostic['code'], 'invalid-input' | 'invalid-import'>;

/** A Model or Language refusal: `validation-failed` with at least one diagnostic. */
interface OwnerRefusal {
  readonly diagnostics: readonly [{ readonly message: string }, ...{ readonly message: string }[]];
}

/** What every refusal tells the caller to do. */
const recovery = 'Correct the named collection source and rerun render:png.';

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

/** The owner's collection, or its refusal as Export's `code` at `path`. */
function document(
  result: Result<Collection, OwnerRefusal>,
  code: DocumentCode,
  path: string,
): Result<Collection, ExportDiagnostic> {
  if (!result.ok) return refused(result.error, code, path);
  return result;
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
