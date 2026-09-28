/*
 * The object inspector: the selected object's label, role, size and content blocks, drawn from its
 * retained draft when it has one. Edits, Apply and Discard go to the inspector session, which owns
 * draft recovery. Inspector calls return a Result; a failure is also published as the inspector's
 * `problem`, which the editor shows in its alert, so the returned Results are not read here. A new
 * content block's ID comes from the ID source; when none can be made the failure is reported and
 * the draft is unchanged.
 */
import { useSyncExternalStore } from 'react';
import type { ComponentType, FunctionComponent, ReactElement } from 'react';
import type { DesignSlots } from '../../contract/react-types.js';
import type { ContentEditorProps } from '../../contract/inspector-react.js';
import type { ObjectDraft, ObjectEdit, ObjectSelection } from '../../contract/records/inspector.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import type { DiagramObject, Target } from '../../contract/records/owners.js';
import type { WorkspaceController, WorkspaceView } from '../../contract/records/workspace.js';
import type { DescendantId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import {
  editedObject,
  failureSummary,
  formatFailure,
  objectDraftKey,
  selectedObject,
} from '../../contract/api.js';
import styles from './ObjectEditor.module.css';

/** What the inspector is drawn with: design slots, the content row editor and new content IDs. */
interface ObjectEditorParts extends Pick<DesignSlots, 'Button' | 'Field'> {
  readonly Content: ComponentType<ContentEditorProps>;
  /** A new content block ID; `id-unavailable` is reported and the draft is kept as it is. */
  nextContentId(): Result<DescendantId>;
}

/** What the inspector reads: its session, the problem report, the open diagram and the link. */
interface ObjectEditorProps {
  readonly controller: Pick<WorkspaceController, 'inspector' | 'report'>;
  readonly view: Pick<WorkspaceView, 'active' | 'busy' | 'connected'>;
}

/** Stable composition keeps content-row components and inspector lifetime independent of panel placement. */
export function createObjectEditor({
  Button,
  Field,
  Content,
  nextContentId,
}: ObjectEditorParts): FunctionComponent<ObjectEditorProps> {
  /** A selection change reads another form; it never discards the previously edited object's draft. */
  function ObjectEditor({ controller, view }: ObjectEditorProps): ReactElement {
    const target = useFirstSelection(view.active);
    const inspector = controller.inspector;
    const forms = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot);
    const selected = selectedObject(view, target);
    if (selected === null)
      return <p>Select an object to edit its content. Double-click opens this inspector.</p>;
    const key = objectDraftKey(selected.collection.id, selected.object.id);
    const draft = forms.drafts.find((item) => item.key === key);
    const object = draftedObject(draft, selected);
    const edit = (command: ObjectEdit): void => {
      inspector.edit(selected, command);
    };
    /** Adds a content block with a new ID; `id-unavailable` is reported and nothing is added. */
    const addContent = (content: ContentKind): void => {
      const id = nextContentId();
      if (!id.ok) {
        controller.report(id.error);
        return;
      }
      edit({ kind: 'add-content', id: id.value, content });
    };
    return (
      <div className={styles.editor}>
        <header>
          <strong>{object.label || 'Untitled object'}</strong>
          <p>
            {object.kind} · {object.id}
          </p>
        </header>
        <Field
          label="Object label"
          control={(props) => (
            <input
              {...props}
              value={object.label}
              onChange={(event) => edit({ kind: 'label', value: event.target.value })}
            />
          )}
        />
        <Field
          label="Semantic role"
          help="Resolved by the collection theme"
          control={(props) => (
            <input
              {...props}
              value={object.role}
              onChange={(event) => edit({ kind: 'role', value: event.target.value })}
            />
          )}
        />
        <div className={styles.choices} aria-label="Object size">
          {sizes.map((value) => (
            <Button
              key={value}
              label={value}
              selected={object.size === value}
              onClick={() => edit({ kind: 'size', value })}
            />
          ))}
        </div>
        {object.content.map((item) => (
          <Content key={item.id} item={item} collection={selected.collection} edit={edit} />
        ))}
        <div className={styles.choices}>
          {additions(object.kind).map((content) => (
            <Button key={content} label={`Add ${content}`} onClick={() => addContent(content)} />
          ))}
        </div>
        {forms.problem && (
          <div role="alert">
            <p>{failureSummary(forms.problem)}</p>
            <details>
              <summary>Technical details</summary>
              {formatFailure(forms.problem).join(' · ')}
            </details>
          </div>
        )}
        {draft && (
          <footer>
            <p>
              Draft from revision {draft.collection.revision}. Shared across every diagram showing
              this object.
            </p>
            <div className={styles.choices}>
              <Button
                label="Apply object"
                variant="primary"
                disabled={view.busy || !view.connected}
                pending={view.busy}
                onClick={() => {
                  void inspector.apply(key);
                }}
              />
              <Button label="Discard object draft" onClick={() => inspector.discard(key)} />
            </div>
          </footer>
        )}
      </div>
    );
  }
  return ObjectEditor;
}

/** The sizes the editor offers. */
const sizes = ['small', 'medium', 'large'] as const;

/** A kind of content block the editor can add. */
type ContentKind = Extract<ObjectEdit, { kind: 'add-content' }>['content'];

/** Offered content follows the visible notation; the final owner still checks compatibility. */
function additions(kind: DiagramObject['kind']): readonly ContentKind[] {
  if (kind === 'entity') return ['field', 'text'];
  if (['module', 'interface', 'function'].includes(kind)) return ['member', 'signature', 'text'];
  return ['text'];
}

/** The object as its draft edits it, or as saved when it has no draft. */
function draftedObject(
  draft: ObjectDraft | undefined,
  selected: ObjectSelection,
): DiagramObject {
  if (draft === undefined) return selected.object;
  return editedObject(draft);
}

/** The Canvas's first selected target in the open diagram; undefined when nothing is selected. */
function useFirstSelection(active: ActiveDiagram | null): Target | undefined {
  const canvas = active?.session ?? null;
  const state = useSyncExternalStore(
    canvas?.subscribe ?? emptySubscribe,
    canvas?.getSnapshot ?? emptySnapshot,
  );
  return state?.selection[0];
}

/** Stable empty subscriptions preserve hook order before any collection exists. */
function emptySubscribe(): () => void {
  return () => undefined;
}

/** Missing Canvas state is explicit and never fabricates a selection. */
function emptySnapshot(): null {
  return null;
}
