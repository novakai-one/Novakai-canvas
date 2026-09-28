import type { Collection } from '../../contract/records/collection.js';
import type { Diagnostic } from '../../contract/errors.js';
import { duplicates } from './duplicates.js';

/**
 * Checks that IDs are unique within each of the collection's record lists, and that theme role
 * names are unique. Each list is its own scope, checked in this order: objects, relationships,
 * sections, assets, sources, definitions, then `theme.roles`. IDs inside objects and sections
 * (descendants, groups) are checked by their own validators.
 *
 * Pure: Authoring owns commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every `duplicate` diagnostic, in that order, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateIdentity(collection: Collection): readonly Diagnostic[] {
  const objectIssues = duplicates(collection.objects, recordId, 'objects');
  const relationshipIssues = duplicates(collection.relationships, recordId, 'relationships');
  const sectionIssues = duplicates(collection.sections, recordId, 'sections');
  const assetIssues = duplicates(collection.assets, recordId, 'assets');
  const sourceIssues = duplicates(collection.sources, recordId, 'sources');
  const definitionIssues = duplicates(collection.definitions, recordId, 'definitions');
  const roleIssues = duplicates(
    collection.theme.roles,
    /** A role's key is its name. */
    (role) => role,
    'theme.roles',
  );
  return [
    ...objectIssues,
    ...relationshipIssues,
    ...sectionIssues,
    ...assetIssues,
    ...sourceIssues,
    ...definitionIssues,
    ...roleIssues,
  ];
}

/** Returns a record's ID, keeping its branded type. */
function recordId<T extends { readonly id: string }>(record: T): T['id'] {
  return record.id;
}
