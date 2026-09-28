/*
 * The Definitions panel: the open collection's shared definitions, one card each, with the name,
 * the expression editor, Model's canonical text, the usages and the draft buttons. Core builds
 * the panel view; this adapter draws it and forwards edits to the retained definition session.
 * A new definition's ID comes from the ID source; when none can be made the failure is reported
 * and nothing is drafted. Session calls return a Result; a failure is also published as the
 * session's `problem`, which the panel shows in its alert, so the returned Results are not read
 * here. A usage click dispatches a canvas select event; if the canvas refuses it, nothing happens.
 */
import { useSyncExternalStore } from 'react';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import type { DefinitionsSlots } from '../../contract/definitions-react.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import type { NodeTarget } from '../../contract/records/owners.js';
import type { WorkspaceController, WorkspaceView } from '../../contract/records/workspace.js';
import type {
  DefinitionDraft,
  DefinitionEntry,
  DefinitionSession,
  DefinitionsPanel,
  UsageItem,
  UsageView,
} from '../../contract/records/definitions.js';
import type { DefinitionId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import {
  applyLabel,
  failureSummary,
  formatFailure,
  newDefinition,
  rootPath,
  usageSelection,
} from '../../contract/api.js';
import { definitionsPanel } from '../../contract/definitions-model.js';
import styles from './ObjectEditor.module.css';

/** What the panel is drawn with: the design slots, the expression editor and new definition IDs. */
interface DefinitionsParts extends DefinitionsSlots {
  /** A new definition ID; `id-unavailable` is reported and nothing is drafted. */
  nextDefinitionId(): Result<DefinitionId>;
}

/** The session calls the panel makes: follow the drafts, then edit, apply or discard them. */
type DefinitionDrafts = Pick<
  DefinitionSession,
  'subscribe' | 'getSnapshot' | 'create' | 'edit' | 'remove' | 'apply' | 'discard'
>;

/** What the panel reads: the definition drafts, the problem report, the open diagram and link. */
interface DefinitionsProps {
  readonly controller: Pick<WorkspaceController, 'report'> & {
    readonly definitions: DefinitionDrafts;
  };
  readonly view: Pick<WorkspaceView, 'active' | 'busy' | 'connected'>;
}

/** Collection owned definitions are edited through the same retained session as object forms. */
export function createDefinitionsEditor({
  Button,
  Field,
  Expression,
  nextDefinitionId,
}: DefinitionsParts): FunctionComponent<DefinitionsProps> {
  /** The panel for the open collection, or a prompt to open one. */
  function Definitions({ controller, view }: DefinitionsProps): ReactElement {
    const session = controller.definitions;
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const active = view.active;
    if (active === null) return <p>Open a collection to edit shared definitions.</p>;
    const panel = definitionsPanel(state, active, view);
    /** Drafts a definition with a new ID; `id-unavailable` is reported and nothing is drafted. */
    const createDefinition = (): void => {
      const id = nextDefinitionId();
      if (!id.ok) {
        controller.report(id.error);
        return;
      }
      session.create(panel.selection, newDefinition(id.value));
    };
    return (
      <div className={styles.editor}>
        <header>
          <strong>Shared definitions</strong>
          <p>Collection owned · {panel.savedCount} saved</p>
        </header>
        <Button label="New definition" onClick={createDefinition} disabled={panel.blocked} />
        {panel.entries.map((entry) => (
          <DefinitionCard
            key={entry.definition.id}
            entry={entry}
            panel={panel}
            session={session}
            active={active}
          />
        ))}
        {state.problem && (
          <div role="alert">
            <p>{failureSummary(state.problem)}</p>
            <details>
              <summary>Technical details</summary>
              {formatFailure(state.problem).join(' · ')}
            </details>
          </div>
        )}
      </div>
    );
  }

  /** One definition: its name, expression, canonical text, usages and draft buttons. */
  function DefinitionCard({ entry, panel, session, active }: CardProps): ReactElement {
    const { definition, draft, pending } = entry;
    const selection = panel.selection;
    return (
      <fieldset className={styles.block}>
        <legend>{definition.label || 'Untitled definition'}</legend>
        <Field
          label="Name"
          control={(props) => (
            <input
              {...props}
              value={definition.label}
              disabled={pending}
              onChange={(event) =>
                session.edit(selection, { ...definition, label: event.target.value }, null, null)
              }
            />
          )}
        />
        <Expression
          expression={definition.expression}
          path={rootPath}
          literalDrafts={entry.literalDrafts}
          definitions={selection.collection.definitions}
          disabled={pending}
          onChange={(expression, editedPath) =>
            session.edit(selection, { ...definition, expression }, null, editedPath)
          }
          onLiteralDraft={(literalDraft) => session.edit(selection, definition, literalDraft, null)}
        />
        <p>Canonical: {entry.canonical}</p>
        <p>Used by {entry.usages.count} field or definition reference(s)</p>
        {usageList(entry.usages, active)}
        <div className={styles.choices}>
          <Button
            label="Delete definition"
            disabled={panel.blocked}
            onClick={() => session.remove(selection, definition)}
          />
          {draftActions(draft, session, panel, pending)}
        </div>
      </fieldset>
    );
  }

  /** Apply and Discard for a card with a draft; nothing for a card without one. */
  function draftActions(
    draft: DefinitionDraft | null,
    session: DefinitionDrafts,
    panel: DefinitionsPanel,
    pending: boolean,
  ): ReactElement | null {
    if (draft === null) return null;
    return (
      <>
        <Button
          label={applyLabel(draft)}
          variant="primary"
          disabled={pending || panel.blocked}
          pending={panel.busy}
          onClick={() => void session.apply(draft.key)}
        />
        <Button
          label="Discard draft"
          disabled={pending}
          onClick={() => session.discard(draft.key)}
        />
      </>
    );
  }

  return Definitions;
}

/** A card's inputs: its entry, the panel it sits in, the session it edits, and the open diagram. */
interface CardProps {
  readonly entry: DefinitionEntry;
  readonly panel: DefinitionsPanel;
  readonly session: DefinitionDrafts;
  readonly active: ActiveDiagram;
}

/** The uses, one list item each; nothing when there are none. */
function usageList(
  usages: UsageView,
  active: ActiveDiagram,
): ReactElement | null {
  if (usages.items.length === 0) return null;
  return (
    <ul>
      {usages.items.map((item) => (
        <li key={item.key}>{usageEntry(item, active)}</li>
      ))}
    </ul>
  );
}

/** A path use is its text; a field use is a button that selects its node, disabled with no node. */
function usageEntry(
  item: UsageItem,
  active: ActiveDiagram,
): ReactNode {
  if (item.kind === 'path') return item.path;
  return (
    <button
      type="button"
      disabled={item.target === null}
      onClick={() => selectUsage(item.target, active)}
    >
      {item.object}.{item.field}
      {item.target === null && ' · Not shown on canvas'}
    </button>
  );
}

/** Selects a usage's node on the canvas; a usage with no node does nothing. */
function selectUsage(
  target: NodeTarget | null,
  active: ActiveDiagram,
): void {
  if (target !== null) active.session.dispatch(usageSelection(target));
}
