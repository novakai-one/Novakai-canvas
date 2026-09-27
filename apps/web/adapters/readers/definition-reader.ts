/*
 * Reads stored definition drafts (schema version 1). Pure: checks untrusted storage and never
 * changes it. One invalid draft fails the whole list with `invalid-definition-draft`; the
 * definitions session reports it and the stored data is kept.
 */
import { z } from 'zod';
import { definitionSchema, validate, type Collection } from '@novakai/canvas-model';
import { requestSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import { capturedCollectionBaseSchema } from '../../contract/schemas/editor-recovery.js';
import type { DefinitionDraft } from '../../contract/records/definitions.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { mapResults } from '../../contract/api.js';

/** The stored shape of one definition draft. */
const draftSchema = z.strictObject({
  kind: z.literal('definition-draft'),
  schemaVersion: z.literal(1),
  key: z.string(),
  base: capturedCollectionBaseSchema,
  generation: transportGeneration,
  collection: z.string(),
  definition: z.unknown(),
  operation: z.enum(['create', 'replace', 'remove']),
  request: requestSchema.optional(),
  literalDrafts: z
    .array(
      z.strictObject({
        path: z.array(z.number().int().nonnegative()).max(20),
        kind: z.enum(['string', 'number', 'boolean']),
        text: z.string(),
      }),
    )
    .max(20)
    .optional(),
});

/** One stored draft after its shape is checked, before its definition and base are. */
type StoredDraft = z.infer<typeof draftSchema>;
/** A checked definition as a draft holds it. */
type Definition = DefinitionDraft['definition'];
/** A stored definition before Model checks it: any object with a `label` key. */
type DefinitionInput = { readonly label?: unknown } & object;

/** The answer when a draft's operation fits its base. */
const IDENTITY_FITS: Result<void> = Object.freeze({ ok: true, value: undefined });

/**
 * Reads a stored list of definition drafts, all or none. Fails with `invalid-definition-draft` when
 * the list is unbounded, or when any draft is malformed, has an invalid definition or base, or
 * names an identity its operation cannot have.
 */
export function readDefinitionDrafts(input: unknown): Result<readonly DefinitionDraft[]> {
  const parsed = z.array(z.unknown()).max(1000).safeParse(input);
  if (!parsed.success) return invalid('Stored definition drafts must be a bounded list');
  return mapResults(parsed.data, readDraft);
}

/** One stored draft, checked. Fails with `invalid-definition-draft`. */
function readDraft(input: unknown): Result<DefinitionDraft> {
  const record = draftSchema.safeParse(input);
  if (!record.success) return invalid('A retained definition draft is invalid');
  return checkedDraft(record.data);
}

/** The draft once its definition, then its base, are valid. Fails with `invalid-definition-draft`. */
function checkedDraft(record: StoredDraft): Result<DefinitionDraft> {
  const definition = readDefinition(record.definition);
  if (!definition.ok) return definition;
  const collection = admitCollection(record, definition.value);
  if (!collection.ok) return collection;
  return {
    ok: true,
    value: {
      key: record.key,
      base: record.base,
      generation: record.generation,
      collection: collection.value,
      definition: definition.value,
      operation: record.operation,
      request: record.request,
      literalDrafts: record.literalDrafts,
    },
  };
}

/**
 * The stored definition, checked by Model with a blank label read as `_` (an unfinished draft),
 * then given back its label as typed. Fails with `invalid-definition-draft`.
 */
function readDefinition(input: unknown): Result<Definition> {
  if (!isDefinitionInput(input)) return invalid('The retained definition is invalid');
  const checked = definitionSchema.safeParse({ ...input, label: admittedLabel(input.label) });
  if (!checked.success) return invalid('The retained definition expression is invalid');
  return { ok: true, value: { ...checked.data, label: typedLabel(input.label) } };
}

/** The base's collection, when Model accepts it. Fails with `invalid-definition-draft`. */
function admitCollection(
  record: StoredDraft,
  definition: Definition,
): Result<Collection> {
  const collection = validate(record.base.record.value);
  if (!collection.ok) return invalid('The retained definition base is invalid');
  return admitIdentity(record.operation, collection.value, definition);
}

/** The collection, when the operation fits it. Fails with `invalid-definition-draft`. */
function admitIdentity(
  operation: StoredDraft['operation'],
  collection: Collection,
  definition: Definition,
): Result<Collection> {
  const identity = checkIdentity(operation, hasDefinition(collection, definition.id));
  if (!identity.ok) return identity;
  return { ok: true, value: collection };
}

/**
 * Create needs an identity the base does not have; replace and remove need one it has. Fails with
 * `invalid-definition-draft`.
 */
function checkIdentity(
  operation: StoredDraft['operation'],
  existing: boolean,
): Result<void> {
  if (operation === 'create') return createIdentity(existing);
  return existingIdentity(operation, existing);
}

/** A create draft fits only a base without its definition. */
function createIdentity(existing: boolean): Result<void> {
  if (existing) return invalid('A create definition identity is already committed');
  return IDENTITY_FITS;
}

/** A replace or remove draft fits only a base with its definition. */
function existingIdentity(
  operation: 'replace' | 'remove',
  existing: boolean,
): Result<void> {
  if (!existing) return invalid(`The ${operation} definition identity is invalid`);
  return IDENTITY_FITS;
}

/** Whether the collection already has a definition with this ID. */
function hasDefinition(
  collection: Collection,
  id: Definition['id'],
): boolean {
  return collection.definitions.some((item) => item.id === id);
}

/** Whether the stored definition is an object with a `label` key. */
function isDefinitionInput(input: unknown): input is DefinitionInput {
  return typeof input === 'object' && input !== null && 'label' in input;
}

/** The label Model checks: the typed text, or `_` while it is blank or not text. */
function admittedLabel(label: unknown): string {
  if (typeof label !== 'string' || label.trim().length === 0) return '_';
  return label;
}

/** The label kept in the draft: the typed text, or empty when it is not text. */
function typedLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label;
}

/** `invalid-definition-draft`: the stored draft cannot be used; it stays stored. */
function invalid(message: string): Extract<Result<never>, { ok: false }> {
  return failure('invalid-definition-draft', message);
}
