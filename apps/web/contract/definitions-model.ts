/*
 * Binds Model to the Definitions panel. Web core imports no capability runtime, so this contract
 * module hands Model's definition display and usage lookups to the core panel builder, and reads
 * the primitive names from Model's own list.
 */
import { definitionDisplay, definitionUsages, primitiveType } from '@novakai/canvas-model';
import { buildDefinitionsPanel, type DefinitionModel } from './api.js';
import type { DefinitionsPanel, DefinitionState, PrimitiveName } from './records/definitions.js';
import type { WorkspaceView } from './records/workspace.js';
import type { ActiveDiagram } from './records/active-diagram.js';

/** The primitive names a definition may use, in Model's order. */
export const primitiveNames: readonly PrimitiveName[] = primitiveType.options;

/** The Definitions panel for the open collection, answered by Model. */
export function definitionsPanel(
  state: DefinitionState,
  active: ActiveDiagram,
  connection: Pick<WorkspaceView, 'busy' | 'connected'>,
): DefinitionsPanel {
  return buildDefinitionsPanel(state, active, connection, model);
}

/** Model's lookups, in the shape the panel builder asks for. */
const model: DefinitionModel = { display: definitionDisplay, usages: definitionUsages };
