import type { ComponentType, ReactElement } from 'react';
import type { ContentEditorProps } from '../../contract/inspector-react.js';
import type { DesignSlots } from '../../contract/react-types.js';
import type { Collection, ContentBlock } from '../../contract/records/owners.js';
import { fieldTypeDisplay } from '@novakai/canvas-model';
import styles from './ObjectEditor.module.css';
/** ER keys and callable signatures have dedicated controls; shared text inputs remain in the content row component. */
export function createEngineeringFields({
  Field,
  Button,
}: Pick<DesignSlots, 'Field' | 'Button'>): ComponentType<ContentEditorProps> {
  /** A foreign-key target is selected by semantic identity. The Model owner validates target uniqueness and type compatibility. */
  function EngineeringFields({ item, collection, edit }: ContentEditorProps): ReactElement | null {
    if (item.kind === 'signature')
      return (
        <div className={styles.editor}>
          {item.parameters.map((parameter, index) => (
            <Field
              key={index}
              label={`Parameter ${index + 1}`}
              control={(props) => (
                <input
                  {...props}
                  value={parameterValue(parameter)}
                  readOnly={typeof parameter !== 'string'}
                  onChange={(event) =>
                    edit({
                      kind: 'parameters',
                      id: item.id,
                      value: item.parameters.map((value, position) =>
                        position === index ? event.target.value : value,
                      ),
                    })
                  }
                />
              )}
            />
          ))}
          <Button
            label="Add parameter"
            onClick={() =>
              edit({
                kind: 'parameters',
                id: item.id,
                value: [...item.parameters, 'input: string'],
              })
            }
          />
          <Button
            label="Remove last parameter"
            disabled={item.parameters.length === 0}
            onClick={() =>
              edit({ kind: 'parameters', id: item.id, value: item.parameters.slice(0, -1) })
            }
          />
        </div>
      );
    if (item.kind !== 'field') return null;
    return (
      <div className={styles.editor}>
        <Field
          label="Type source"
          control={(props) => (
            <select
              {...props}
              value={typeChoice(item)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'mode:unlinked') {
                  edit({
                    kind: 'field-type',
                    id: item.id,
                    value: fieldTypeDisplay(collection, item),
                  });
                  return;
                }
                const definition = collection.definitions.find(
                  (candidate) => `definition:${candidate.id}` === value,
                );
                if (definition)
                  edit({
                    kind: 'field-type',
                    id: item.id,
                    value: { kind: 'definition', id: definition.id },
                  });
              }}
            >
              <option value="mode:unlinked">Unlinked (authored type)</option>
              {collection.definitions.map((definition) => (
                <option key={definition.id} value={`definition:${definition.id}`}>
                  Shared: {definition.label} ·{' '}
                  {fieldTypeDisplay(collection, {
                    ...item,
                    type: { kind: 'definition', id: definition.id },
                  })}{' '}
                  · @{definition.id}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          label="Key"
          control={(props) => (
            <select
              {...props}
              value={item.key ?? 'none'}
              onChange={(event) => {
                const value = keys.find((key) => key === event.target.value);
                if (value) edit({ kind: 'field-key', id: item.id, value });
              }}
            >
              {keys.map((key) => (
                <option key={key} value={key}>
                  {keyLabels[key]}
                </option>
              ))}
            </select>
          )}
        />
        {item.key === 'foreign' && (
          <Field
            label="References"
            control={(props) => (
              <select
                {...props}
                value={referenceValue(item)}
                onChange={(event) => {
                  const choice = referenceTargets(collection).find(
                    (choice) => choice.value === event.target.value,
                  );
                  if (choice) edit({ kind: 'field-reference', id: item.id, target: choice.target });
                }}
              >
                <option value="">Choose a referenced field</option>
                {referenceTargets(collection).map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
          />
        )}
      </div>
    );
  }
  return EngineeringFields;
}

/** One signature parameter as Model types it: authored text, or a name with a type or definition. */
type SignatureParameter = Extract<ContentBlock, { kind: 'signature' }>['parameters'][number];

function parameterValue(parameter: SignatureParameter): string {
  if (typeof parameter === 'string') return parameter;
  return `${parameter.name}: ${typeof parameter.type === 'string' ? parameter.type : `@${parameter.type.id}`}`;
}
const keys = ['none', 'primary', 'foreign', 'unique'] as const;
const keyLabels = {
  none: 'No key',
  primary: 'Primary key (PK)',
  foreign: 'Foreign key (FK)',
  unique: 'Unique key (UQ)',
};
/** UI option identity carries two semantic IDs and never relies on their displayed labels being unique. */
function referenceTargets(collection: Collection) {
  return collection.objects.flatMap((object) =>
    object.content
      .filter((item) => item.kind === 'field')
      .map((item) => ({
        value: JSON.stringify([object.id, item.id]),
        label: `${object.label}.${item.label}`,
        target: { object: object.id, member: item.id },
      })),
  );
}
/** Missing references remain an explicit incomplete choice until the human selects a target. */
function referenceValue(field: Extract<ContentBlock, { kind: 'field' }>): string {
  if (!field.references) return '';
  return JSON.stringify([field.references.object, field.references.member]);
}
function typeChoice(field: Extract<ContentBlock, { kind: 'field' }>): string {
  return typeof field.type === 'string' ? 'mode:unlinked' : `definition:${field.type.id}`;
}
