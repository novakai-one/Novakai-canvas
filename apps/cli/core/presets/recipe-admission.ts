/*
 * Why this file exists
 *
 * `recipe admit plan.canvas --id plan --version 1.0.0 --family er --title "Plan"` saves a recipe
 * for reuse. A recipe file is ordinary `.canvas` text, so Language must be able to parse it first.
 * Parsing also finds the fonts and images it names, which must be stored before the save.
 *
 * This file parses the text, then pairs it with the typed `--id`, `--version`, `--family` and
 * `--title` as the recipe to save. The text is kept exactly as written. It never reads a file or
 * talks to the service.
 */
import type { SourceParser } from '../../contract/ports/source-parser.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { Admission, ResourceRequest } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { parseSource } from '../shared/parse-source.js';
import { mapped } from '../shared/results.js';

/** A recipe to save, in the form Templates accepts. Templates calls this an admission. */
export type RecipeAdmission = Extract<Admission, { readonly kind: 'recipe' }>;

/** A parsed recipe file: the recipe to save, and the fonts and images it names, to store first. */
export interface RecipeSource {
  readonly admission: RecipeAdmission;
  readonly resources: readonly ResourceRequest[];
}

/**
 * Parses recipe text into the recipe to save and the fonts and images it names.
 * `recipeText` is the file's text as read; Language checks it here. The recipe keeps it unchanged,
 * with the typed `header` and an empty description.
 * The mistake it can find: Language can't parse the text (`invalid-source`).
 */
export function parseRecipe(
  header: RecipeHeader,
  recipeText: string,
  language: SourceParser,
): Result<RecipeSource> {
  return mapped(parseSource(language, recipeText), (parsed) => ({
    admission: recipeAdmission(header, recipeText),
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
