/*
 * `recipe admit`'s admission: the checked header and the editable DSL source as a Templates recipe
 * admission, plus the font and image declarations the source makes. Pure apart from the injected
 * Language parser. Templates owns the canonical form and the immutable identity. The caller fixes
 * the recipe file and runs the command again.
 */
import type { SourceLanguage } from '../../contract/ports/source-language.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { Admission, ResourceRequest } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { parseSource } from '../shared/parse-source.js';
import { mapped } from '../shared/results.js';

/** A Templates recipe admission. */
export type RecipeAdmission = Extract<Admission, { readonly kind: 'recipe' }>;

/** A recipe file's admission and the resources its source declares, to stage first. */
export interface RecipeSource {
  readonly admission: RecipeAdmission;
  readonly resources: readonly ResourceRequest[];
}

/** The recipe's admission and declarations. Fails with `invalid-source`. */
export function recipeSource(
  header: RecipeHeader,
  text: string,
  language: SourceLanguage,
): Result<RecipeSource> {
  return mapped(parseSource(language, text), (parsed) => ({
    admission: recipeAdmission(header, text),
    resources: parsed.resources,
  }));
}

/** The admission record: the header, no description, and the source exactly as written. */
function recipeAdmission(
  header: RecipeHeader,
  source: string,
): RecipeAdmission {
  return { schemaVersion: 1, kind: 'recipe', ...header, description: '', source };
}
