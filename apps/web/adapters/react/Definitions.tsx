/*
 * The Definitions panel: the open collection's shared definitions, one card each, with the name,
 * the expression editor, Model's canonical text, the usages and the draft buttons. Core builds
 * the panel view; this adapter draws it and forwards edits to the retained definition session.
 * Session calls return a Result; a failure is also published as the session's `problem`, which
 * the panel shows in its alert, so the returned Results are not read here. A usage click
 * dispatches a canvas select event; if the canvas refuses it, nothing happens.
 */
import { useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { FeatureProps } from '../../contract/react-types.js';
import type { DefinitionsSlots } from '../../contract/definitions-react.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import type { NodeTarget } from '../../contract/records/owners.js';
import type {
  DefinitionDraft,
  DefinitionEntry,
  DefinitionSession,
  DefinitionsPanel,
  UsageView,
} from '../../contract/records/definitions.js';
import {
  applyLabel,
  definitionDraftId,
  failureSummary,
  formatFailure,
  newDefinition,
  rootPath,
  usageSelection,
} from '../../contract/api.js';
import { definitionsPanel } from '../../contract/definitions-model.js';
import styles from './ObjectEditor.module.css';

/** Collection owned definitions are edited through the same retained session as object forms. */
export function createDefinitionsEditor({
  Button,
  Field,
  Expression,
}: DefinitionsSlots): ComponentType<FeatureProps> {
  /** The panel for the open collection, or a prompt to open one. */
  function Definitions({ controller, view }: FeatureProps): ReactElement {
    const session = controller.definitions;
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const active = view.active;
    if (active === null) return <p>Open a collection to edit shared definitions.</p>;
    const panel = definitionsPanel(state, active, view);
    return (
      <div className={styles.editor}>
        <header>
          <strong>Shared definitions</strong>
          <p>Collection owned · {panel.savedCount} saved</p>
        </header>
        <Button
          label="New definition"
          onClick={() =>
            session.create(
              panel.selection,
              newDefinition(definitionDraftId(`definition-${crypto.randomUUID()}`)),
            )
          }
          disabled={panel.blocked}
        />
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
    session: DefinitionSession,
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
  readonly session: DefinitionSession;
  readonly active: ActiveDiagram;
}

/** The uses; a field use is a button that selects its node, disabled when no node shows it. */
function usageList(
  usages: UsageView,
  active: ActiveDiagram,
): ReactElement | null {
  if (usages.items.length === 0) return null;
  return (
    <ul>
      {usages.items.map((item) => (
        <li key={item.key}>
          {item.kind === 'field' ? (
            <button
              type="button"
              disabled={item.target === null}
              onClick={() => selectUsage(item.target, active)}
            >
              {item.object}.{item.field}
              {item.target === null && ' · Not shown on canvas'}
            </button>
          ) : (
            item.path
          )}
        </li>
      ))}
    </ul>
  );
}

/** Selects a usage's node on the canvas; a usage with no node does nothing. */
function selectUsage(
  target: NodeTarget | null,
  active: ActiveDiagram,
): void {
  if (target !== null) active.session.dispatch(usageSelection(target));
}
