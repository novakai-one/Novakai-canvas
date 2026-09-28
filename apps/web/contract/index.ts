/** Browser host public entry. Canonical diagram writes remain service requests admitted by Authoring. */
export { startWeb, createInspectorSession, createWireSession } from './compose.js';
export { planCanvasEdit, panelVisible, reconcilePanelPreferences } from './api.js';
export type { CollectionSwitch, WorkspaceController, WorkspaceView } from './records/workspace.js';
export type { Result, Diagnostic } from './errors.js';
export type { EditContext } from './records/editing.js';

export { failure } from './errors.js';

export { editedObject, objectDraftKey } from './api.js';
export { buildMoveReview, chooseMoveOption } from './api.js';
export { editedWire, wireDraftKey, wireChanges } from './api.js';
export type { InspectorBindings, ObjectSelection } from './records/inspector.js';
export type {
  GeometryChange,
  MoveOption,
  MoveOptionKind,
  MovePolicy,
  MoveReview,
} from './records/movement.js';

export { groupCreationChanges, groupDraftProblem } from './api.js';
export { plainMessage, planPaletteDrop } from './api.js';
