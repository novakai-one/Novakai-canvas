/*
 * Binds Model to the workspace session. Web core imports no capability runtime, so this contract
 * module reads Model's connection tables and ID grammars once, as the connection policy. New IDs
 * come from the ID source (`ports/ids.ts`), never from here. Declarations only; nothing throws.
 */
import {
  compatibleWires,
  descendantId,
  genericMemberEndpoints,
  memberEndpoints,
  relationshipId,
  relationshipKind,
  resolveCallableEndpoint,
  sourceEndpoints,
  targetEndpoints,
} from '@novakai/canvas-model';
import type { ConnectionPolicy } from './api.js';

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
