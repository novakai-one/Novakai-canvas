/*
 * The one source of new IDs. Declarations only; `adapters/edge/ids.ts` implements it from the
 * browser's random text. The facade and the executors call it; core never mints, so minted IDs
 * arrive on events. Every method answers a `Result`; the only failure is `id-unavailable`, and
 * the caller reports it and keeps its draft.
 */
import type { Result } from '../errors.js';
import type {
  CollectionId,
  DefinitionId,
  DescendantId,
  FolderId,
  GroupId,
  ObjectId,
  RelationshipId,
  RequestId,
  SectionId,
} from '../brands.js';

/**
 * New IDs, each built from one UUID from `random` and checked with its owner's schema. Every
 * method either returns a new ID or fails with `id-unavailable`. Uniqueness comes from `random`.
 */
export interface IdSource {
  /** A new Authoring request ID: `<uuid>`. */
  requestId(): Result<RequestId>;
  /** A new Model collection ID: `collection-<uuid>` (Model IDs start with a letter). */
  collectionId(): Result<CollectionId>;
  /** A new Model section (diagram) ID: `section-<uuid>`. */
  sectionId(): Result<SectionId>;
  /** A new Model object ID: `object-<uuid>`. */
  objectId(): Result<ObjectId>;
  /** A new Model group ID: `group-<uuid>`. */
  groupId(): Result<GroupId>;
  /** A new Model relationship (wire) ID: `relationship-<uuid>`. */
  relationshipId(): Result<RelationshipId>;
  /** A new Model definition ID: `definition-<uuid>`. */
  definitionId(): Result<DefinitionId>;
  /** A new Model content ID (port, content block or row): `content-<uuid>`. */
  descendantId(): Result<DescendantId>;
  /** A new Library folder ID: `folder-<uuid>`. */
  folderId(): Result<FolderId>;
}
