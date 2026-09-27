/*
 * The ID source: reads one UUID from the browser's random text per ID, prefixes it with the ID's
 * kind and checks the result with its owner's schema (Authoring the request ID, Library the folder
 * ID, Model the rest) using `safeParse`. It checks shape only; uniqueness comes from `random`.
 * Pure apart from calling `random`; nothing is written. Every method answers a `Result` and never
 * throws, even when `random` throws; on `id-unavailable` the caller reports it and keeps its draft.
 */
import type { z } from 'zod';
import { requestId } from '@novakai/canvas-authoring';
import {
  collectionId,
  definitionId,
  descendantId,
  groupId,
  objectId,
  relationshipId,
  sectionId,
} from '@novakai/canvas-model';
import { folderIdSchema } from '@novakai/canvas-library';
import type { IdSource } from '../../contract/ports/ids.js';
import type { BrowserGlobals } from '../../contract/ports/browser-globals.js';
import type { Result } from '../../contract/errors.js';
import { diagnostic } from '../../contract/errors.js';

/** An owner's ID schema: it checks text and gives that owner's branded ID. */
type IdSchema = z.ZodType<string, string>;

/**
 * The ID source over `random`. Each call reads one UUID and prefixes it with the ID's kind
 * (`<uuid>` for a request, `collection-<uuid>`, `folder-<uuid>` and so on; the text of each is on
 * `IdSource`). Every method either returns a new ID or fails with `id-unavailable`: when `random`
 * throws, when its text is not a UUID, or when the owner's schema rejects the ID.
 */
export function createIdSource(random: BrowserGlobals['random']): IdSource {
  const folderId = folderIdSchema();
  const mint = <S extends IdSchema>(schema: S, prefix: string): Result<z.output<S>> =>
    checkedId(schema, prefix, randomUuid(random));
  return {
    requestId: () => mint(requestId, ''),
    collectionId: () => mint(collectionId, 'collection-'),
    sectionId: () => mint(sectionId, 'section-'),
    objectId: () => mint(objectId, 'object-'),
    groupId: () => mint(groupId, 'group-'),
    relationshipId: () => mint(relationshipId, 'relationship-'),
    definitionId: () => mint(definitionId, 'definition-'),
    descendantId: () => mint(descendantId, 'content-'),
    folderId: () => mint(folderId, 'folder-'),
  };
}

/**
 * Checks `prefix` + `uuid` with the owner's `schema`. Fails with `id-unavailable` when there is
 * no UUID or the schema rejects the text.
 */
function checkedId<S extends IdSchema>(
  schema: S,
  prefix: string,
  uuid: Result<string>,
): Result<z.output<S>> {
  if (!uuid.ok) return uuid;
  const checked = schema.safeParse(`${prefix}${uuid.value}`);
  if (!checked.success) return { ok: false, error: idUnavailable };
  return { ok: true, value: checked.data };
}

/**
 * Calls `random` once. Fails with `id-unavailable` when it throws (`crypto.randomUUID` is missing
 * outside a secure context) or its text is not a UUID (`8-4-4-4-12` hex digits).
 */
function randomUuid(random: BrowserGlobals['random']): Result<string> {
  const text = readRandom(random);
  if (text === undefined || !uuidShape.test(text)) return { ok: false, error: idUnavailable };
  return { ok: true, value: text };
}

/** Calls `random` once. Answers `undefined` when it throws. */
function readRandom(random: BrowserGlobals['random']): string | undefined {
  try {
    return random();
  } catch {
    return undefined;
  }
}

/** A UUID's text: 8-4-4-4-12 hex digits, either case. */
const uuidShape = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** The one failure: no valid ID could be made. Nothing was sent or stored. */
const idUnavailable = Object.freeze(
  diagnostic(
    'id-unavailable',
    'A new ID could not be made.',
    'Keep your draft and try again. If this keeps happening, reload the page.',
  ),
);
