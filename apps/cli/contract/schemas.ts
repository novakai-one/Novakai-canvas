/*
 * Schemas another owner declares that the CLI checks with. Pure declarations. Authoring's request,
 * snapshot and receipt schemas are re-exported, never copied. Templates does not export its family
 * schema, so recipe families are a typed copy that stops compiling when Templates' Admission adds,
 * drops or renames one. A value these schemas reject becomes the failure code its caller names.
 */
import { z } from 'zod';
import type { RecipeFamily } from './records/foreign.js';

export { receiptSchema, requestSchema, snapshotSchema } from '@novakai/canvas-authoring';

/** Every recipe family, keyed by itself: a missing, extra or misspelt family is a type error. */
const recipeFamilies = Object.freeze({
  er: 'er',
  modules: 'modules',
  sop: 'sop',
  mindmap: 'mindmap',
  sequence: 'sequence',
  infographic: 'infographic',
} as const satisfies { readonly [Family in RecipeFamily]: Family });

/** A recipe's diagram family, as Templates' `Admission` declares it. */
export const recipeFamily = z.enum(recipeFamilies);
