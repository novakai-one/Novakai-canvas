/*
 * Binds Model to the workspace session. Web core imports no capability runtime, so this contract
 * module reads Model's connection tables and member-ID grammar once, as the connection policy.
 * New IDs come from the ID source (`ports/ids.ts`), never from here. Declarations only; nothing
 * throws.
 */
import {
  compatibleWires,
  descendantId,
  genericMemberEndpoints,
  memberEndpoints,
  relationshipKind,
  resolveCallableEndpoint,
  sourceEndpoints,
  targetEndpoints,
} from '@novakai/canvas-model';
import type { ConnectionPolicy } from './api.js';

/** Model's connection policy and member-ID grammar, in the shape the connection pipeline uses. */
export const connectionPolicy: ConnectionPolicy = {
  compatibleWires,
  allKinds: relationshipKind.options,
  memberEndpoints,
  genericMemberEndpoints,
  sourceEndpoints,
  targetEndpoints,
  callable: resolveCallableEndpoint,
  descendantId,
};
