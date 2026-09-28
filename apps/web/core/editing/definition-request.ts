/*
 * Turning a definition draft into a model request: create and replace carry the definition,
 * remove carries its ID. Pure: the request ID arrives from the caller, which took it from the ID
 * source and reuses a draft's own request instead of building a new one. Authoring owns
 * admission, commit and recovery.
 */
import type { Result } from '../../contract/errors.js';
import type { RequestBuilders } from '../../contract/ports/request-builders.js';
import type { Change, Request } from '../../contract/records/owners.js';
import type { DefinitionDraft } from '../../contract/records/definitions.js';
import type { RequestId } from '../../contract/brands.js';

/**
 * Builds the model request of a definition draft under `request`, expecting the draft's base.
 * Fails as the model builder does (`invalid-recovery`, `invalid-request`).
 */
export function definitionRequest(
  draft: DefinitionDraft,
  builders: Pick<RequestBuilders, 'model'>,
  request: RequestId,
): Result<Request> {
  return builders.model(draft.base, draft.collection.id, definitionChanges(draft), request);
}

/** The changes of a draft: remove carries the ID; create and replace carry the definition. */
function definitionChanges(draft: DefinitionDraft): readonly Change[] {
  if (draft.operation === 'remove') {
    return [{ op: 'remove', target: 'definitions', id: draft.definition.id }];
  }
  return [{ op: draft.operation, target: 'definitions', value: draft.definition }];
}
