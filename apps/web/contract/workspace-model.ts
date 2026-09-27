/*
 * Binds Model to the workspace session. Web core imports no capability runtime, so this contract
 * module reads Model's connection tables and ID grammars once: the connection policy, the brands
 * for the IDs an Add form mints, and the group grammar an added object's group is checked against.
 */
import {
  compatibleWires,
  descendantId,
  genericMemberEndpoints,
  groupId,
  memberEndpoints,
  objectId,
  relationshipId,
  relationshipKind,
  resolveCallableEndpoint,
  sectionId,
  sourceEndpoints,
  targetEndpoints,
} from '@novakai/canvas-model';
import type { ConnectionPolicy, IdGrammar } from './api.js';
import type { DiagramObject, Group, Section } from './records/owners.js';

/** Model's connection policy and ID grammars, in the shape the connection pipeline asks for. */
export const connectionPolicy: ConnectionPolicy = {
  compatibleWires,
  allKinds: relationshipKind.options,
  memberEndpoints,
  genericMemberEndpoints,
  sourceEndpoints,
  targetEndpoints,
  callable: resolveCallableEndpoint,
  descendantId,
  relationshipId,
};

/** Model's group ID grammar, for the group an added object joins. */
export const groupGrammar: IdGrammar<Group['id']> = groupId;

/** Brands a new diagram's ID; `parse` throws only for text outside Model's ID grammar. */
export function sectionDraftId(value: string): Section['id'] {
  return sectionId.parse(value);
}

/** Brands a new object's ID; `parse` throws only for text outside Model's ID grammar. */
export function objectDraftId(value: string): DiagramObject['id'] {
  return objectId.parse(value);
}

/** Brands a new group's ID; `parse` throws only for text outside Model's ID grammar. */
export function groupDraftId(value: string): Group['id'] {
  return groupId.parse(value);
}
