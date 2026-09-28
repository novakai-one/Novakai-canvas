/*
 * The stored format of definition drafts, version 1. The session writes these records and the
 * definition reader reads them back. Fields are written in the order listed here.
 */
import type { DefinitionDraft } from '../../contract/records/definitions.js';

/** One stored definition draft. `request` and `literalDrafts` are written even when undefined. */
export interface DefinitionDraftRecord {
  readonly kind: 'definition-draft';
  readonly schemaVersion: 1;
  readonly key: DefinitionDraft['key'];
  readonly base: DefinitionDraft['base'];
  readonly generation: DefinitionDraft['generation'];
  readonly collection: DefinitionDraft['collection']['id'];
  readonly definition: DefinitionDraft['definition'];
  readonly operation: DefinitionDraft['operation'];
  readonly request: DefinitionDraft['request'];
  readonly literalDrafts: DefinitionDraft['literalDrafts'];
}

/** The stored records of the drafts, in draft order. */
export function encodeDefinitionDrafts(
  drafts: readonly DefinitionDraft[],
): readonly DefinitionDraftRecord[] {
  return drafts.map(encodeDraft);
}

/** One draft as stored; the collection is stored by its ID. */
function encodeDraft(draft: DefinitionDraft): DefinitionDraftRecord {
  return {
    kind: 'definition-draft',
    schemaVersion: 1,
    key: draft.key,
    base: draft.base,
    generation: draft.generation,
    collection: draft.collection.id,
    definition: draft.definition,
    operation: draft.operation,
    request: draft.request,
    literalDrafts: draft.literalDrafts,
  };
}
