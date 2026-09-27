/*
 * The three Add forms: Diagram, Object and Group. Each form draws the view it is given and
 * forwards draft edits, cancel and submit to the panel; it keeps no state. The fields arrive as
 * slots from composition.
 */
import type { FormEvent, ReactElement } from 'react';
import type {
  AddFormProps,
  AddFormComponents,
  AddFormsSlots,
} from '../../contract/creation-react.js';
import type {
  AddDiagramDraft,
  AddGroupDraft,
  AddObjectDraft,
  FormView,
  GroupFormView,
  ObjectFormView,
} from '../../contract/records/creation.js';
import styles from './AddTools.module.css';

/** The Diagram, Object and Group forms, drawn with the design's Field and the Add fields. */
export function createAddForms({
  Field,
  DiagramField,
  ModuleField,
  NameField,
  FormActions,
}: AddFormsSlots): AddFormComponents {
  /** The Diagram form: a name for a new blank grid diagram. */
  function DiagramForm({
    form,
    onDraft,
    onCancel,
    onSubmit,
  }: AddFormProps<AddDiagramDraft, FormView<AddDiagramDraft>>): ReactElement {
    const { draft, busy } = form;
    return (
      <section aria-labelledby="add-diagram-title">
        <h3 id="add-diagram-title">Diagram</h3>
        <p className={styles.hint}>
          Start with a blank grid and add the first module when you are ready.
        </p>
        <form className={styles.form} onSubmit={submitWith(() => onSubmit(form.request))}>
          <NameField
            label="Diagram name"
            value={draft.title}
            busy={busy}
            onName={(title) => onDraft({ ...draft, title })}
          />
          <FormActions busy={busy} submit={form.submit} onCancel={onCancel} />
        </form>
      </section>
    );
  }

  /** The Object form: diagram, reuse, module name and group; the empty note with no diagram. */
  function ObjectForm({
    form,
    onDraft,
    onCancel,
    onSubmit,
  }: AddFormProps<AddObjectDraft, ObjectFormView | null>): ReactElement {
    if (form === null) return <ObjectEmpty />;
    const { draft, busy } = form;
    return (
      <section aria-labelledby="add-object-title">
        <h3 id="add-object-title">Object</h3>
        <form className={styles.form} onSubmit={submitWith(() => onSubmit(form.request))}>
          <DiagramField
            sections={form.sections}
            section={form.section}
            busy={busy}
            onSection={(section) => onDraft({ ...draft, section })}
          />
          <Field
            label="Reuse existing object"
            control={(field) => (
              <select
                {...field}
                disabled={busy}
                value={draft.reuseObject ?? ''}
                onChange={(event) => onDraft({ ...draft, reuseObject: event.target.value || null })}
              >
                <option value="">Create a new module</option>
                {form.reuse.map((choice) => (
                  <option key={choice.id} value={choice.id} disabled={choice.disabled}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
          />
          <ModuleField form={form} onDraft={onDraft} />
          <Field
            label="Group"
            control={(field) => (
              <select
                {...field}
                disabled={busy}
                value={draft.group ?? ''}
                onChange={(event) => onDraft({ ...draft, group: event.target.value || null })}
              >
                <option value="">No group</option>
                {form.groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            )}
          />
          {form.duplicate && (
            <p role="alert">
              That object is already in this diagram. Pick another object or diagram.
            </p>
          )}
          <FormActions busy={busy} submit={form.submit} onCancel={onCancel} />
        </form>
      </section>
    );
  }

  /** The Group form: diagram, name and room to move. With no diagram it shows the Object note. */
  function GroupForm({
    form,
    onDraft,
    onCancel,
    onSubmit,
  }: AddFormProps<AddGroupDraft, GroupFormView | null>): ReactElement {
    if (form === null) return <ObjectEmpty />;
    const { draft, busy } = form;
    return (
      <section aria-labelledby="add-group-title">
        <h3 id="add-group-title">Group</h3>
        <form className={styles.form} onSubmit={submitWith(() => onSubmit(form.request))}>
          <DiagramField
            sections={form.sections}
            section={form.section}
            busy={busy}
            onSection={(section) => onDraft({ ...draft, section })}
          />
          <NameField
            label="Group name"
            value={draft.title}
            busy={busy}
            onName={(title) => onDraft({ ...draft, title })}
          />
          <label>
            <input
              type="checkbox"
              checked={form.findRoom}
              disabled={busy}
              onChange={(event) => onDraft({ ...draft, findRoom: event.target.checked })}
            />
            Allow this diagram to move to make room
          </label>
          <p>May move and resize this diagram. Other diagrams keep their saved positions.</p>
          <FormActions busy={busy} submit={form.submit} onCancel={onCancel} />
        </form>
      </section>
    );
  }

  return { DiagramForm, ObjectForm, GroupForm };
}

/** A submit handler: the page stays, and the action runs without being awaited. */
function submitWith(action: () => Promise<void>): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    void action();
  };
}

/** The Object form when the collection has no diagram to add to. */
function ObjectEmpty(): ReactElement {
  return (
    <section aria-labelledby="add-object-title">
      <h3 id="add-object-title">Object</h3>
      <p className={styles.empty}>Add a diagram before adding an object.</p>
    </section>
  );
}
