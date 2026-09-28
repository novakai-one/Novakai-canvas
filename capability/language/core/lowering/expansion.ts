/*
 * Expanding a recipe: a complete `canvas 1` source is lowered as a new collection whose ID is
 * the requested namespace. No writes. Language owns correcting the source; Authoring owns
 * commit and retry recovery.
 */
import type { Dependencies } from '../../contract/types.js';
import type { ExpansionRequest, LoweredIntent } from '../../contract/records/requests.js';
import { parseSource } from '../parsing/document.js';
import { accepted, reject, protect } from '../validation/outcomes.js';
import type { Result } from '../../contract/errors.js';
import { lowerDocument } from './document.js';

/**
 * Expands a recipe into a new collection. Only the root collection's ID changes to
 * `input.namespace`; text that happens to match the old ID (labels, URIs, code, references) is
 * not rewritten. The result is lowered in `create` mode, with no snapshot.
 *
 * No writes: a retry with the same input and the same Model roles returns the same result.
 */
export function expandRecipe(
  input: ExpansionRequest,
  deps: Dependencies,
): Result<LoweredIntent> {
  return protect(() => expandedRecipe(input, deps));
}

/** Parses the recipe, gives its root the new ID, then lowers it as a new collection. */
function expandedRecipe(
  input: ExpansionRequest,
  deps: Dependencies,
): LoweredIntent {
  const parsed = parseSource(input.source);
  if (parsed.kind !== 'canvas')
    reject(
      'invalid-input',
      parsed.span,
      'Complete canvas1 source',
      'A patch cannot instantiate a recipe',
    );
  const declaration = {
    ...parsed.declaration,
    fields: {
      ...parsed.declaration.fields,
      id: { value: input.namespace, span: parsed.declaration.span },
    },
  };
  return accepted(
    lowerDocument(
      { ...parsed, collection: input.namespace, declaration },
      { source: input.source, mode: 'create', snapshot: null, resources: input.resources },
      deps,
    ),
  );
}
