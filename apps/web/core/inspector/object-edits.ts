/*
 * An object form's draft: its key, and the object its retained edits produce. `objectDraftKey` is
 * the only maker of `ObjectDraftKey`. Pure; no function here fails, so there is nothing to recover.
 * Model and Authoring decide at Apply whether the edited object is valid.
 */
import type { DiagramObject, ContentBlock } from '../../contract/records/owners.js';
import type { ObjectDraft, ObjectEdit } from '../../contract/records/inspector.js';
import type { CollectionId, ObjectDraftKey, ObjectId } from '../../contract/brands.js';
import { objectDraftKeySchema } from '../../contract/brands.js';
/**
 * The key of an object's form: its collection and object, as JSON text. It names one form whichever
 * diagram appearance selected the object. The only maker of `ObjectDraftKey`; never fails.
 */
export function objectDraftKey(
  collection: CollectionId,
  object: ObjectId,
): ObjectDraftKey {
  return objectDraftKeySchema.parse(JSON.stringify([collection, object]));
}
/** Readable form data is derived from retained intentions. Only Model/Authoring may admit its final validity. */
export function editedObject(draft: ObjectDraft): DiagramObject {
  return draft.edits.reduce(applyEdit, draft.object);
}
/** The closed command registry names each UI operation; new editor controls add their own operation here. */
const operations: Readonly<
  Record<ObjectEdit['kind'], (object: DiagramObject, edit: ObjectEdit) => DiagramObject>
> = {
  label: editLabel,
  role: editRole,
  size: editSize,
  notation: editNotation,
  'content-text': editContentText,
  nullable: editNullable,
  'field-key': editKey,
  'field-reference': editReference,
  'field-type': editType,
  parameters: editParameters,
  'remove-content': removeContent,
  'add-content': addContent,
};
/** One retained command changes only its named aspect; all other semantic fields remain present. */
function applyEdit(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  return operations[edit.kind](object, edit);
}
/** Empty labels remain editable drafts; final Model validation owns the nonblank invariant. */
function editLabel(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'label') return object;
  return { ...object, label: edit.value };
}
/** Semantic roles resolve through the collection theme when the draft is admitted. */
function editRole(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'role') return object;
  return { ...object, role: edit.value };
}
/** Human sizing uses the same semantic size options as agent DSL. */
function editSize(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'size') return object;
  return { ...object, size: edit.value };
}
/** A notation change preserves contents for correction; Model rejects incompatible final content. */
function editNotation(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'notation') return object;
  return { ...object, kind: edit.value };
}
/** Stable descendant IDs allow text edits without rewriting relationships or other content rows. */
function editContentText(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'content-text') return object;
  return { ...object, content: object.content.map((item) => replaceText(item, edit)) };
}
/** The UI names the edited text property; inappropriate property/kind combinations fail final owner admission. */
function replaceText(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'content-text' }>,
): ContentBlock {
  if (item.id !== edit.id) return item;
  return replaceEditableText(item, edit);
}

function replaceEditableText(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'content-text' }>,
): ContentBlock {
  if (preservesLinkedType(item, edit.field)) return item;
  return { ...item, [edit.field]: edit.value };
}

function preservesLinkedType(
  item: ContentBlock,
  field: 'label' | 'type' | 'text' | 'returns',
): boolean {
  if (field === 'type') return 'type' in item && typeof item.type !== 'string';
  return preservesLinkedReturn(item, field);
}

function preservesLinkedReturn(
  item: ContentBlock,
  field: 'label' | 'type' | 'text' | 'returns',
): boolean {
  if (field !== 'returns' || item.kind !== 'signature') return false;
  return typeof item.returns !== 'string';
}
/** Nullable belongs to an ER field, never to an arbitrary content block. */
function editNullable(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'nullable') return object;
  return { ...object, content: object.content.map((item) => nullableField(item, edit)) };
}
/** A missing or non-field row remains unchanged; final owner checks still run before submission. */
function nullableField(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'nullable' }>,
): ContentBlock {
  if (item.kind !== 'field') return item;
  if (item.id !== edit.id) return item;
  return { ...item, nullable: edit.value };
}
/** Removing a referenced descendant can invalidate the draft; Model reports it before any commit. */
function removeContent(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'remove-content') return object;
  return { ...object, content: object.content.filter((item) => item.id !== edit.id) };
}
/** New rows get their stable identity once, when the user chooses Add. Replay never allocates another ID. */
function addContent(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'add-content') return object;
  return { ...object, content: [...object.content, contentDefaults[edit.content](edit.id)] };
}
/** Form defaults are editable suggestions; validity remains Model's responsibility. */
const contentDefaults: Readonly<
  Record<
    Extract<ObjectEdit, { kind: 'add-content' }>['content'],
    (id: ContentBlock['id']) => ContentBlock
  >
> = {
  text: (id) => ({ id, kind: 'text', text: 'Explain this idea', role: 'body' }),
  field: (id) => ({ id, kind: 'field', label: 'field', type: 'string', nullable: false }),
  member: (id) => ({ id, kind: 'member', label: 'member', type: 'string', visibility: 'public' }),
  signature: (id) => ({ id, kind: 'signature', label: 'execute', parameters: [], returns: 'void' }),
};
/** ER key edits retain identity and clear reference metadata when the field no longer represents a foreign key. */
function editKey(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'field-key') return object;
  return { ...object, content: object.content.map((item) => keyField(item, edit)) };
}
/** Only the selected ER field can change its key metadata. */
function keyField(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'field-key' }>,
): ContentBlock {
  if (item.kind !== 'field') return item;
  if (item.id !== edit.id) return item;
  return withKey(item, edit.value);
}
/** Removing a key removes its foreign reference; switching to foreign requires an explicit target before admission. */
function withKey(
  item: Extract<ContentBlock, { kind: 'field' }>,
  key: 'none' | 'primary' | 'foreign' | 'unique',
): ContentBlock {
  const field = {
    kind: item.kind,
    id: item.id,
    label: item.label,
    type: item.type,
    nullable: item.nullable,
  };
  if (key === 'none') return field;
  return { ...field, key };
}
/** Foreign references name a canonical descendant, independent of its row position on the canvas. */
function editReference(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'field-reference') return object;
  return { ...object, content: object.content.map((item) => referenceField(item, edit)) };
}
function editType(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'field-type') return object;
  return { ...object, content: object.content.map((item) => typeField(item, edit)) };
}
function typeField(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'field-type' }>,
): ContentBlock {
  if (item.kind !== 'field' || item.id !== edit.id) return item;
  return { ...item, type: edit.value };
}
/** A reference selection also explicitly marks the row as a foreign key. */
function referenceField(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'field-reference' }>,
): ContentBlock {
  if (item.kind !== 'field') return item;
  if (item.id !== edit.id) return item;
  return { ...item, key: 'foreign', references: edit.target };
}
/** Callable parameters remain separate ordered labels; commas inside a type are never used as parsing delimiters. */
function editParameters(
  object: DiagramObject,
  edit: ObjectEdit,
): DiagramObject {
  if (edit.kind !== 'parameters') return object;
  return { ...object, content: object.content.map((item) => parametersFor(item, edit)) };
}
/** Only callable signatures own parameter lists. */
function parametersFor(
  item: ContentBlock,
  edit: Extract<ObjectEdit, { kind: 'parameters' }>,
): ContentBlock {
  if (item.kind !== 'signature') return item;
  if (item.id !== edit.id) return item;
  return { ...item, parameters: edit.value };
}
