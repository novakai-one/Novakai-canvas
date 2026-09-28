import type { ComponentType, ReactElement } from 'react';
import type { ContentEditorProps } from '../../contract/inspector-react.js';
import type { DesignSlots } from '../../contract/react-types.js';
import type { ContentBlock } from '../../contract/records/owners.js';
import styles from './ObjectEditor.module.css';
/** Shared row frame delegates every field to typed draft commands; stable IDs retain React input identity. */
export function createContentEditor({
  Button,
  Field,
  Engineering,
}: Pick<DesignSlots, 'Button' | 'Field'> & {
  readonly Engineering: ComponentType<ContentEditorProps>;
}): ComponentType<ContentEditorProps> {
  /** Each supported block exposes the properties relevant to its notation, with no raw JSON editing. */
  function ContentEditor({ item, collection, edit }: ContentEditorProps): ReactElement {
    return (
      <fieldset className={styles.block}>
        <legend>
          {item.kind} · {item.id}
        </legend>
        {textFields(item).map((field) => (
          <Field
            key={field.name}
            label={field.label}
            control={(props) => (
              <input
                {...props}
                value={field.value}
                readOnly={field.readOnly}
                onChange={(event) =>
                  edit({
                    kind: 'content-text',
                    id: item.id,
                    field: field.name,
                    value: event.target.value,
                  })
                }
              />
            )}
          />
        ))}
        {item.kind === 'field' && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={item.nullable}
              onChange={(event) =>
                edit({ kind: 'nullable', id: item.id, value: event.target.checked })
              }
            />
            Allow null values
          </label>
        )}
        <Engineering item={item} collection={collection} edit={edit} />
        <Button
          label={`Remove ${contentName(item)}`}
          onClick={() => edit({ kind: 'remove-content', id: item.id })}
        />
      </fieldset>
    );
  }
  return ContentEditor;
}
interface TextField {
  readonly name: 'label' | 'type' | 'text' | 'returns';
  readonly label: string;
  readonly value: string;
  readonly readOnly?: boolean;
}
/** Structural narrowing exposes available text fields without casts or duplicating Model validation. */
function textFields(item: ContentBlock): readonly TextField[] {
  return [...labelField(item), ...typeField(item), ...bodyField(item), ...returnField(item)];
}
/** Labels belong to named engineering members and links. */
function labelField(item: ContentBlock): readonly TextField[] {
  if (!('label' in item)) return [];
  return [{ name: 'label', label: 'Name', value: item.label }];
}
/** Returns the block's name for the Remove button, or its kind when the block has no name. */
function contentName(item: ContentBlock): string {
  return 'label' in item && item.label ? item.label : item.kind;
}
/** Engineering types are explicit strings owned by the semantic record. */
function typeField(item: ContentBlock): readonly TextField[] {
  if (!('type' in item)) return [];
  if (linkedType(item))
    return [{ name: 'type', label: 'Type (source)', value: typeValue(item.type), readOnly: true }];
  return [
    {
      name: 'type',
      label: 'Type',
      value: typeValue(item.type),
    },
  ];
}

function typeValue(type: Extract<ContentBlock, { readonly type: unknown }>['type']): string {
  if (typeof type === 'string') return type;
  return `@${type.id}`;
}

function linkedType(item: ContentBlock & { readonly type?: unknown }): boolean {
  return 'type' in item && typeof item.type !== 'string';
}
/** Text and code retain their authored content exactly. */
function bodyField(item: ContentBlock): readonly TextField[] {
  if (!('text' in item)) return [];
  return [{ name: 'text', label: 'Text', value: item.text }];
}
/** Return types are distinct from member types in callable signatures. */
function returnField(item: ContentBlock): readonly TextField[] {
  if (item.kind !== 'signature') return [];
  return [
    {
      name: 'returns',
      label: typeof item.returns === 'string' ? 'Returns' : 'Returns (source)',
      value: typeValue(item.returns),
      readOnly: typeof item.returns !== 'string',
    },
  ];
}
