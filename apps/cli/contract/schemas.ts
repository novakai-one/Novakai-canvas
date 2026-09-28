/*
 * Why this file exists
 *
 * Some checks the CLI runs belong to other parts. A request the CLI sends must pass Authoring's
 * own request check, not a copy that could drift from it. And core must run checks without
 * importing the library the checks are written in.
 *
 * This file passes on Authoring's checks, names `Parser` (the one thing core uses from any check),
 * and checks recipe families. Whoever runs a check decides which failure a refusal becomes.
 */
import { z } from 'zod';
import type { RecipeFamily } from './records/foreign.js';

export { receiptSchema, requestSchema, snapshotSchema } from '@novakai/canvas-authoring';

/**
 * Any check core can run. `safeParse` gives back the checked value, often as a checked type such
 * as `FilePath`, or says the input failed.
 */
export interface Parser<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

/** Every recipe family, keyed by itself: a missing, extra or misspelt family is a type error. */
const recipeFamilies = Object.freeze({
  er: 'er',
  modules: 'modules',
  sop: 'sop',
  mindmap: 'mindmap',
  sequence: 'sequence',
  infographic: 'infographic',
} as const satisfies { readonly [Family in RecipeFamily]: Family });

/**
 * Checks a recipe's diagram family, such as `er`. Templates doesn't share its own check, so this
 * copy stops compiling if Templates adds, drops or renames a family.
 */
export const recipeFamily = z.enum(recipeFamilies);
