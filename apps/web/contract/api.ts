/*
 * Web core's public surface: adapters reach core only through these re-exports, so core files can
 * move without adapter edits. One function of its own, `definitionDraftId`, which throws Zod's
 * `ZodError` for text outside Model's ID grammar. Nothing catches that throw: its one caller, the
 * Definitions panel, passes `definition-<UUID>`, which always fits. Pure; no state.
 */
import { definitionId, type DefinitionId } from '@novakai/canvas-model';

export { planCanvasEdit } from '../core/editing/plan.js';

export {
  blocksSubmission,
  submissionStatus,
  emptyRefusalOrder,
  observeRefusals,
  supersededRefusal,
} from '../core/editing/submissions.js';
export { refused } from '../core/workspace/rules/refusal-classes.js';

export {
  defaultPanels,
  panelMode,
  openPanel,
  resizePanels,
  panelVisible,
  panelGeometry,
  panelTabSide,
} from '../core/workspace/panel-state.js';
export {
  movePanelSection,
  panelMembership,
  panelWidth,
  reconcilePanelPreferences,
  storedPanels,
} from '../core/panels/preferences.js';
export {
  unrestoredWorkspace,
  restoredWorkspace,
  snapshotScope,
  inWorkspace,
} from '../core/workspace/workspace-scope.js';
export { editedObject, objectDraftKey } from '../core/inspector/object-edits.js';
export { selectedObject } from '../core/inspector/selection.js';
export { defaultPreferences } from '../core/preferences/defaults.js';
export { preferenceFailure, storageFailure } from '../core/preferences/failures.js';
export { editedWire, wireChanges, wireDraftKey } from '../core/inspector/wire-edits.js';
export { selectedWire } from '../core/inspector/wire-selection.js';
export { retainObjectCommand, retainWireCommand } from '../core/inspector/draft-commands.js';
export { endpointKey, endpointChoices } from '../core/inspector/endpoints.js';
export {
  baseWorkspace,
  captureCollectionBase,
  collectionRecord,
  encodeObjectRecovery,
  encodeSourceRecovery,
  encodeWireRecovery,
} from '../core/recovery/editor-records.js';

export { formatFailure, failureSummary, plainMessage } from '../core/output/diagnostics.js';
export { buildMoveReview, chooseMoveOption } from '../core/editing/movement.js';
export { palette, planPaletteDrop, type PaletteDrop } from '../core/editing/palette-drop.js';

/** Brands a new definition ID. Throws `ZodError` for text outside Model's ID grammar; no caller catches it. */
export function definitionDraftId(value: string): DefinitionId {
  return definitionId.parse(value);
}
export { buildDefinitionsPanel, newDefinition, applyLabel } from '../core/definitions/panel.js';
export type { DefinitionModel } from '../core/definitions/panel.js';
export { usageSelection } from '../core/definitions/usages.js';
export {
  rootPath,
  replaceAlternative,
  addAlternative,
  removeLastAlternative,
  canRemoveAlternative,
} from '../core/definitions/expression-edits.js';
export {
  literalKinds,
  chosenPrimitive,
  chosenReference,
  chosenLiteralKind,
} from '../core/definitions/choices.js';
export {
  literalKindOf,
  literalKindChange,
  literalTextChange,
  literalBooleanChange,
  literalDraftAt,
} from '../core/definitions/literal-edits.js';
export { samePath, isPathWithin } from '../core/definitions/paths.js';
export { editedDrafts, type DefinitionEdit } from '../core/definitions/draft-edits.js';
export {
  restoredState,
  applyingState,
  discardedDrafts,
  boundDrafts,
  settledRequest,
  unlocked,
  unlockedWithoutRequest,
  withoutDraft,
  type RequestOutcome,
  type SettledRequest,
} from '../core/definitions/draft-lifecycle.js';
export { encodeDefinitionDrafts } from '../core/definitions/draft-record.js';

export { buildCreationPanel } from '../core/creation/panel.js';
export { groupDraftProblem, groupCreationChanges } from '../core/editing/group-creation.js';
export {
  buildConnectionDraft,
  editedConnection,
  resolveConnectionSection,
  reviewConnection,
  type ConnectionCapture,
  type ConnectionReview,
} from '../core/editing/connection/draft.js';
export { connectionRequest } from '../core/editing/connection/request.js';
export type { ConnectionPolicy, IdGrammar } from '../core/editing/connection/types.js';
export {
  connectionProblem,
  releasedConnection,
  withRequestState,
} from '../core/editing/connection/capture.js';
export { definitionRequest } from '../core/editing/definition-request.js';
export { reusableSession, retainCamera, renderChanged } from '../core/workspace/session-reuse.js';
export { bindHistoryKeys } from '../core/workspace/history-keys.js';
export { shellLayout, type ShellLayout } from '../core/workspace/shell-layout.js';
export {
  renderTicket,
  type RenderMode,
  type RenderTicket,
} from '../core/workspace/diagram/ticket.js';
export {
  documentFor,
  generationChanged,
  generationFailure,
  renderAdmission,
  renderInvalidation,
  snapshotBase,
  type LatestSnapshot,
} from '../core/workspace/diagram/admission.js';
export {
  installedPatch,
  openFailurePatch,
  openingPatch,
  openSuccessPatch,
  reusedPatch,
} from '../core/workspace/render/patches.js';
export {
  activeRefresh,
  choosePlan,
  choosingPatch,
  closedSwitchPatch,
  diagramCurrent,
  gonePatch,
  staleSnapshot,
} from '../core/workspace/render/navigation.js';
export {
  editingStatus,
  mutationAvailable,
  openDraftCount,
  restingStatus,
  staleUncertainty,
  type CollectionDraft,
} from '../core/workspace/status.js';
export {
  heldHistory,
  historyIdle,
  historyReady,
  historyView,
  inverseSettling,
  observeSnapshot,
  settlingHistory,
  type HistorySlot,
} from '../core/workspace/history/gate.js';
export {
  editsHeld,
  finishedInverse,
  navigableStatus,
  submissionAllowed,
  unresolvedInverses,
} from '../core/workspace/history/journal.js';
export {
  reviewableMovement,
  reviewOutcome,
  type ReviewOutcome,
} from '../core/workspace/movement-review/outcome.js';
export {
  applicable,
  awaitingChoice,
  currentChoice,
  failedPhase,
  heldFor,
  heldMovement,
  inPhase,
  moveSubmissionBlocked,
  offeredOption,
  recoveryPhase,
  requestedIn,
  savingRequest,
  sendingMove,
  withOption,
} from '../core/workspace/movement-review/phases.js';
export {
  alreadySaving,
  movementActive,
  operationBusy,
  optionPreviewRefused,
  previewGone,
  previewRefused,
} from '../core/workspace/movement-review/failures.js';
export type { MovementHeld, MovementSlot } from '../core/workspace/movement-review/types.js';
export {
  captureFor,
  creationLocked,
  dismissedCaptures,
  holding,
  landedElsewhere,
  noCaptures,
  refusedCaptures,
  released,
  settledCaptures,
  withRequest,
  type CaptureIds,
  type CreationCapture,
  type CreationCaptures,
} from '../core/creation/captures.js';
export {
  addedCreation,
  cancelledCreation,
  emptyCreation,
  refusedElsewhereNote,
  settledCreation,
} from '../core/creation/drafts.js';
export {
  capturedIn,
  creationContext,
  diagramChanges,
  diagramTarget,
  groupChanges,
  objectChanges,
} from '../core/creation/records.js';
