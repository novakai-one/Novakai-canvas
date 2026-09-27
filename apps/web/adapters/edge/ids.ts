/*
 * The ID source: builds each new ID from the browser's random text and checks it with its owner's
 * schema (Authoring the request ID, Library the folder ID, Model the rest) using `safeParse`.
 * Pure apart from the random text supplied at composition; nothing is written. Every method
 * answers a `Result` and never throws; on `id-unavailable` the caller reports it and keeps its
 * draft.
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
 * The ID source over `random`. Each call reads fresh random text and prefixes it with the ID's
 * kind (`<uuid>` for a request, `collection-<uuid>`, `folder-<uuid>` and so on; the text of each is
 * on `IdSource`). Every method fails with `id-unavailable` when the owner's schema rejects the text.
 */
export function createIdSource(random: BrowserGlobals['random']): IdSource {
  const folderId = folderIdSchema();
  const mint = <S extends IdSchema>(schema: S, prefix: string): Result<z.output<S>> =>
    checkedId(schema, `${prefix}${random()}`);
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

/** Checks `text` with the owner's `schema`. Fails with `id-unavailable` when it is rejected. */
function checkedId<S extends IdSchema>(
  schema: S,
  text: string,
): Result<z.output<S>> {
  const checked = schema.safeParse(text);
  if (!checked.success) return { ok: false, error: idUnavailable };
  return { ok: true, value: checked.data };
}

/** The one failure: the random text did not make a valid ID. Nothing was sent or stored. */
const idUnavailable = Object.freeze(
  diagnostic(
    'id-unavailable',
    'A new ID could not be made.',
    'Keep your draft and try again. If this keeps happening, reload the page.',
  ),
);
