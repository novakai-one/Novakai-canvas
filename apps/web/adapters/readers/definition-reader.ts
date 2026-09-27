import { z } from 'zod';
import { definitionSchema, validate, type Collection } from '@novakai/canvas-model';
import { capturedCollectionBaseSchema } from '../../contract/schemas/editor-recovery.js';
import type { DefinitionDraft } from '../../contract/records/definitions.js';
import { requestSchema } from '@novakai/canvas-authoring';
import { transportGeneration } from '@novakai/canvas-service';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

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

export function readDefinitionDrafts(input: unknown): Result<readonly DefinitionDraft[]> {
  const parsed = z.array(z.unknown()).max(1000).safeParse(input);
  if (!parsed.success)
    return failure('invalid-definition-draft', 'Stored definition drafts must be a bounded list');
  const records = parsed.data.map((item) => readDraft(item));
  const rejected = records.find((item) => !item.ok);
  if (rejected) return rejected;
  return { ok: true, value: records.flatMap((item) => (item.ok ? [item.value] : [])) };
}

function readDraft(input: unknown): Result<DefinitionDraft> {
  const parsed = readRecord(input);
  if (!parsed.ok) return parsed;
  return buildDraft(parsed.value);
}

function buildDraft(record: z.infer<typeof draftSchema>): Result<DefinitionDraft> {
  const definition = readDefinition(record.definition);
  if (!definition.ok) return definition;
  const collection = admitDraft(record);
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

function admitDraft(record: z.infer<typeof draftSchema>): Result<Collection> {
  const collection = validate(record.base.record.value);
  if (!collection.ok)
    return failure('invalid-definition-draft', 'The retained definition base is invalid');
  return admitIdentity(record, collection.value);
}

function admitIdentity(
  record: z.infer<typeof draftSchema>,
  collection: Collection,
): Result<Collection> {
  const definition = readDefinition(record.definition);
  if (!definition.ok) return definition;
  const identity = checkIdentity(record.operation, hasDefinition(collection, definition.value.id));
  return identity.ok ? { ok: true, value: collection } : identity;
}

function hasDefinition(
  collection: Collection,
  id: DefinitionDraft['definition']['id'],
): boolean {
  return collection.definitions.some((item) => item.id === id);
}

function readDefinition(input: unknown): Result<DefinitionDraft['definition']> {
  const inputError = definitionInputError(input);
  if (inputError !== null) return inputError;
  const value = input as { readonly label?: unknown } & object;
  return parseDefinition(value);
}

function parseDefinition(
  value: { readonly label?: unknown } & object,
): Result<DefinitionDraft['definition']> {
  const checked = definitionSchema.safeParse({
    ...value,
    label: admittedLabel(value.label),
  });
  if (!checked.success)
    return failure('invalid-definition-draft', 'The retained definition expression is invalid');
  return {
    ok: true,
    value: { ...checked.data, label: typeof value.label === 'string' ? value.label : '' },
  };
}

function definitionInputError(input: unknown): Extract<Result<never>, { ok: false }> | null {
  return isDefinitionInput(input)
    ? null
    : failure('invalid-definition-draft', 'The retained definition is invalid');
}

function isDefinitionInput(input: unknown): input is { readonly label?: unknown } & object {
  return typeof input === 'object' && input !== null && 'label' in input;
}

function admittedLabel(label: unknown): string {
  return typeof label === 'string' && label.trim().length > 0 ? label : '_';
}

function readRecord(input: unknown): Result<z.infer<typeof draftSchema>> {
  const parsed = draftSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure('invalid-definition-draft', 'A retained definition draft is invalid');
}

function checkIdentity(
  operation: 'create' | 'replace' | 'remove',
  original: boolean,
): Result<void> {
  return operation === 'create' ? createIdentity(original) : existingIdentity(operation, original);
}

function createIdentity(original: boolean): Result<void> {
  return original
    ? failure('invalid-definition-draft', 'A create definition identity is already committed')
    : { ok: true, value: undefined };
}

function existingIdentity(
  operation: 'replace' | 'remove',
  original: boolean,
): Result<void> {
  return original
    ? { ok: true, value: undefined }
    : failure('invalid-definition-draft', `The ${operation} definition identity is invalid`);
}
