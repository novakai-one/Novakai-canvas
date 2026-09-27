/*
 * The Definitions panel view for the open collection. Saved definitions come first, each shown
 * through its draft when one exists; definitions that exist only as drafts follow, in draft
 * order. Web core imports no capability runtime, so the contract binding injects Model's display
 * and usage lookups (DefinitionModel).
 */
import type {
  Definition,
  DefinitionDraft,
  DefinitionEntry,
  DefinitionId,
  DefinitionsPanel,
  DefinitionState,
  DisplayOutcome,
  UsageOutcome,
} from '../../contract/records/definitions.js';
import type { Collection } from '../../contract/records/owners.js';
import type { WorkspaceView } from '../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import { canonicalText, usageView } from './usages.js';

/** Model's answers about one definition, injected by the contract binding. */
export interface DefinitionModel {
  display(
    collection: Collection,
    id: DefinitionId,
  ): DisplayOutcome;
  usages(
    collection: Collection,
    id: DefinitionId,
  ): UsageOutcome;
}

/** The panel: one entry per definition, and the flags that lock its controls. */
export function buildDefinitionsPanel(
  state: DefinitionState,
  active: ActiveDiagram,
  connection: Pick<WorkspaceView, 'busy' | 'connected'>,
  model: DefinitionModel,
): DefinitionsPanel {
  const collection = active.document.collection;
  const drafts = state.drafts.filter((draft) => draft.collection.id === collection.id);
  const saved = collection.definitions.map((definition) => savedRow(definition, drafts));
  const created = drafts
    .filter((draft) => !collection.definitions.some((item) => item.id === draft.definition.id))
    .map((draft) => draftedRow(draft, drafts));
  return {
    selection: { base: active.base, generation: active.generation, collection },
    savedCount: collection.definitions.length,
    busy: connection.busy,
    blocked: connection.busy || !connection.connected,
    entries: [...saved, ...created].map((row) => entry(row, state.pending, active, model)),
  };
}

/** A new definition: a union of two string literals under a placeholder name. */
export function newDefinition(id: DefinitionId): Definition {
  return {
    id,
    label: 'New definition',
    expression: {
      kind: 'union',
      items: [
        { kind: 'literal', value: 'Human' },
        { kind: 'literal', value: 'Agent' },
      ],
    },
  };
}

/** The Apply button's label: a deletion draft applies a deletion. */
export function applyLabel(draft: DefinitionDraft): string {
  return draft.operation === 'remove' ? 'Apply deletion' : 'Apply definition';
}

/** A definition to show, and the draft that edits it, if any. */
interface Row {
  readonly definition: Definition;
  readonly draft: DefinitionDraft | null;
}

/** A saved definition, shown through its draft when one exists. */
function savedRow(
  definition: Definition,
  drafts: readonly DefinitionDraft[],
): Row {
  const draft = firstDraft(drafts, definition.id);
  return { definition: draft?.definition ?? definition, draft };
}

/** A definition that exists only as a draft; its card uses the first draft for that ID. */
function draftedRow(
  draft: DefinitionDraft,
  drafts: readonly DefinitionDraft[],
): Row {
  return { definition: draft.definition, draft: firstDraft(drafts, draft.definition.id) };
}

/** One card. A row with no draft tests the key '' against pending, so a pending '' locks it. */
function entry(
  row: Row,
  pending: readonly string[],
  active: ActiveDiagram,
  model: DefinitionModel,
): DefinitionEntry {
  const collection = active.document.collection;
  return {
    definition: row.definition,
    draft: row.draft,
    literalDrafts: row.draft?.literalDrafts ?? [],
    pending: pending.includes(row.draft?.key ?? ''),
    canonical: canonicalText(model.display(collection, row.definition.id)),
    usages: usageView(model.usages(collection, row.definition.id), active.document.scene),
  };
}

/** The first draft for a definition ID: the one lookup each row makes. */
function firstDraft(
  drafts: readonly DefinitionDraft[],
  id: DefinitionId,
): DefinitionDraft | null {
  return drafts.find((draft) => draft.definition.id === id) ?? null;
}
