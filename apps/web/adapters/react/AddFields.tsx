/*
 * The Add fields: the Diagram select, the name inputs and the form buttons. Each field draws the
 * value it is given and forwards edits; it keeps no state. The Diagram select forwards only a
 * listed diagram's ID. The forms receive these as slots from composition.
 */
import type { ReactElement } from 'react';
import type { DesignSlots } from '../../contract/react-types.js';
import type {
  AddFieldComponents,
  DiagramFieldProps,
  FormActionsProps,
  ModuleFieldProps,
  NameFieldProps,
} from '../../contract/creation-react.js';
import { listedId } from '../../contract/api.js';
import styles from './AddTools.module.css';

/** The Add fields, drawn with the design's Field and Button. */
export function createAddFields({
  Field,
  Button,
}: Pick<DesignSlots, 'Field' | 'Button'>): AddFieldComponents {
  /** The required Diagram select over the diagrams that take adds. */
  function DiagramField({ sections, section, busy, onSection }: DiagramFieldProps): ReactElement {
    /** Forwards the listed diagram the select names; other text changes nothing. */
    const chooseSection = (value: string): void => {
      const chosen = listedId(sections, value);
      if (chosen !== null) onSection(chosen);
    };
    return (
      <Field
        label="Diagram"
        required
        control={(field) => (
          <select
            {...field}
            disabled={busy}
            value={section}
            onChange={(event) => chooseSection(event.target.value)}
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
      />
    );
  }

  /** The Module name input; none while an existing object is reused. */
  function ModuleField({ form, onDraft }: ModuleFieldProps): ReactElement | null {
    if (!form.newModule) return null;
    const draft = form.draft;
    return (
      <NameField
        label="Module name"
        value={draft.label}
        busy={form.busy}
        onName={(label) => onDraft({ ...draft, label })}
      />
    );
  }

  /** A required name input. */
  function NameField({ label, value, busy, onName }: NameFieldProps): ReactElement {
    return (
      <Field
        label={label}
        required
        control={(field) => (
          <input
            {...field}
            disabled={busy}
            value={value}
            onChange={(event) => onName(event.target.value)}
          />
        )}
      />
    );
  }

  /** Cancel, and the form's submit button. */
  function FormActions({ busy, submit, onCancel }: FormActionsProps): ReactElement {
    return (
      <div className={styles.actions}>
        <Button label="Cancel" type="button" disabled={busy} onClick={onCancel} />
        <Button label={submit.label} type="submit" variant="primary" disabled={submit.disabled} />
      </div>
    );
  }

  return { DiagramField, ModuleField, NameField, FormActions };
}
