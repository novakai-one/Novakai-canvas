import { historyStatusSchema } from '@novakai/canvas-authoring';
import type { GeometryPreview } from '@novakai/canvas-canvas';
import type { ObjectDraft } from '../../contract/records/inspector.js';
import type { Change, Collection, DiagramObject, Snapshot } from '../../contract/records/owners.js';
import type {
  AddDiagramDraft,
  AddGroupDraft,
  AddObjectDraft,
  CreationKind,
} from '../../contract/records/creation.js';
import type { ConnectionDraft, ConnectionEdit } from '../../contract/records/connection.js';
import type { MoveOption, MoveReview } from '../../contract/records/movement.js';
import type { DefinitionDraft } from '../../contract/records/definitions.js';
import type { CarriedSnapshot, Submission } from '../../contract/records/submission.js';
import type { Receipt } from '../../contract/records/owners.js';
import type { WorkspaceController, WorkspaceView } from '../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type { CollectionId, TransportGeneration } from '../../contract/brands.js';
import type { WorkspaceBindings } from '../../contract/ports/workspace.js';
import type {
  Request,
  CanvasEffect,
  RenderDocument,
  EditIntent,
  PlacementIntent,
  TransportResponse,
} from '../../contract/records/owners.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { diagnostic } from '../../contract/errors.js';
import { canvasFailure, foreignFailure, wireOutcome } from '../../contract/foreign-failures.js';
import type { BinaryResponse, CommitNotice } from '../../contract/ports/client.js';
import {
  plainMessage,
  emptyRefusalOrder,
  observeRefusals,
  supersededRefusal,
  chooseMoveOption as chooseReviewedMoveOption,
  buildConnectionDraft,
  connectionProblem,
  connectionRequest,
  definitionRequest,
  editedConnection,
  releasedConnection,
  resolveConnectionSection,
  reviewConnection,
  reusableSession,
  retainCamera,
  bindHistoryKeys,
  renderTicket,
  documentFor,
  generationChanged,
  generationFailure,
  renderAdmission,
  renderInvalidation,
  snapshotBase,
  installedPatch,
  openFailurePatch,
  openingPatch,
  openSuccessPatch,
  reusedPatch,
  activeRefresh,
  choosePlan,
  choosingPatch,
  closedSwitchPatch,
  gonePatch,
  staleSnapshot,
  editingStatus,
  mutationAvailable,
  openDraftCount,
  restingStatus,
  staleUncertainty,
  editsHeld,
  finishedInverse,
  heldHistory,
  historyIdle,
  historyReady,
  historyView,
  inverseSettling,
  navigableStatus,
  observeSnapshot,
  settlingHistory,
  submissionAllowed,
  unresolvedInverses,
  addedCreation,
  cancelledCreation,
  capturedIn,
  captureFor,
  creationContext,
  creationLocked,
  diagramChanges,
  diagramTarget,
  dismissedCaptures,
  emptyCreation,
  groupChanges,
  holding,
  landedElsewhere,
  noCaptures,
  objectChanges,
  refusedCaptures,
  refusedElsewhereNote,
  released,
  settledCaptures,
  settledCreation,
  withRequest,
  alreadySaving,
  applicable,
  awaitingChoice,
  currentChoice,
  failedPhase,
  heldFor,
  heldMovement,
  inPhase,
  moveSubmissionBlocked,
  movementActive,
  offeredOption,
  operationBusy,
  optionPreviewRefused,
  previewGone,
  previewRefused,
  recoveryPhase,
  requestedIn,
  reviewableMovement,
  reviewOutcome,
  savingRequest,
  sendingMove,
  withOption,
  withRequestState,
  inWorkspace,
  restoredWorkspace,
  snapshotScope,
  unrestoredWorkspace,
  unreadGeneration,
  readGeneration,
  currentGeneration,
  type AdmittedRender,
  type CaptureIds,
  type CollectionDraft,
  type ConnectionCapture,
  type ConnectionReview,
  type CreationCapture,
  type CreationCaptures,
  type HistorySlot,
  type LatestSnapshot,
  type MovementHeld,
  type MovementSlot,
  type RenderMode,
  type RenderTicket,
} from '../../contract/api.js';
import { connectionPolicy } from '../../contract/workspace-model.js';

/** A render in flight: its ticket, the token that decides delivery, and the transport abort. */
interface RenderRequest extends RenderTicket {
  readonly token: number;
  readonly job: AbortController;
}
/** Ephemeral orchestration state contains immutable snapshots. Authoring is the sole owner of committed diagram data. */
export function createWorkspaceController(bindings: WorkspaceBindings): WorkspaceController {
  const source = bindings.source({
    changed: (view) => update(view),
    report,
    submit,
    current: () => state.active,
  });
  let state: WorkspaceView = {
    snapshot: null,
    generation: unreadGeneration,
    collections: [],
    active: null,
    opening: null,
    collectionSwitch: { phase: 'idle', activeId: null },
    status: 'Connecting…',
    problem: null,
    connected: false,
    busy: false,
    pending: [],
    movementReview: null,
    connection: null,
    creation: emptyCreation(),
    history: { status: null, busy: false },
    ...source.getSnapshot(),
  };
  const listeners = new Set<() => void>();
  const confirmedGestures = new Set<string>();
  let unsubscribe = (): void => undefined;
  let rendering: RenderRequest | null = null;
  let requestToken = 0;
  let disposed = false;
  let snapshotRead = 0;
  let restoredScope: WorkspaceScope = unrestoredWorkspace;
  let historyGate: HistorySlot = historyIdle;
  /** The held movement review; its phase says whether it is being applied. */
  let movementSlot: MovementSlot = null;
  let connectionCapture: ConnectionCapture | null = null;
  let historyRead = 0;
  let creationCaptures: CreationCaptures = noCaptures;
  /** Each Add form's new ID from the ID source, taken once when its capture is made. */
  const creationIds: CaptureIds = {
    diagram: bindings.ids.sectionId,
    object: bindings.ids.objectId,
    group: bindings.ids.groupId,
  };
  let removeHistoryKeys = (): void => undefined;
  const inspector = bindings.inspector({ apply: applyObject, report });
  const definitions = bindings.definitions({ apply: applyDefinition, report });
  const wires = bindings.wires({ apply: applyChanges, report });
  const library = bindings.library({ apply: applyLibrary, report });
  const stopEditorStatus = [inspector, wires, definitions].map((editor) =>
    editor.subscribe(refreshRestingStatus),
  );
  let refusalOrder = emptyRefusalOrder;
  const submissions = bindings.submissions({ changed: pendingChanged, confirmed, report });
  /** An inverse that left the journal unrefused holds the undo/redo gate until it settles. */
  function holdConfirmedHistory(pending: readonly Submission[]): void {
    if (finishedInverse(state.pending, pending)) setHistoryGate(heldHistory(historyGate));
  }
  /** Transmission status is independent of typing and retained failures. */
  function pendingChanged(pending: readonly Submission[]): void {
    // One refusal is visible: the latest, until another edit starts. Dismissing republishes the journal.
    refusalOrder = observeRefusals(refusalOrder, pending);
    const superseded = supersededRefusal(refusalOrder);
    if (superseded !== undefined) dismissRequest(superseded);
    // Publish even if that dismissal failed, so the journal view never stalls on a hidden refusal.
    const shown = pending.filter((item) => item.request.request !== superseded);
    releaseRefusedDefinitions(shown);
    publishPending(shown);
  }
  /** A refused definition changed nothing; its draft becomes editable now, so a reload cannot leave it locked. */
  function releaseRefusedDefinitions(pending: readonly Submission[]): void {
    pending
      .filter((item) => item.state === 'rejected')
      .forEach((item) => definitions.released(item.request.request));
  }
  function publishPending(pending: readonly Submission[]): void {
    holdConfirmedHistory(pending);
    const connection = pendingConnectionView(pending);
    update({
      pending,
      busy: pending.some((item) => item.state === 'sending'),
      creation: { ...state.creation, busy: creationLocked(creationCaptures) },
      ...(connection === undefined ? {} : { connection }),
    });
    updateMutationAvailability();
    if (movementSlot !== null) updateMovementRecovery(movementSlot.capture.intent.id);
  }
  /** The connection draft following its request's journal state; undefined when it has no request there. */
  function pendingConnectionView(pending: readonly Submission[]): ConnectionDraft | undefined {
    const followedCapture = withRequestState(connectionCapture, pending);
    if (followedCapture === null) return undefined;
    connectionCapture = followedCapture;
    return followedCapture.draft;
  }
  /** Listeners receive a new immutable view; Canvas panning has its own narrower subscription. */
  function update(patch: Partial<WorkspaceView>): void {
    const cleared = problemCleared(patch);
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
    if (cleared) dismissRefusals();
  }
  function problemCleared(patch: Partial<WorkspaceView>): boolean {
    return state.problem !== null && patch.problem === null;
  }
  /** A refusal is shown only as the error bar, so once that bar is gone the refused request goes too. */
  function dismissRefusals(): void {
    state.pending
      .filter((item) => item.state === 'rejected')
      .forEach((item) => dismissRequest(item.request.request));
  }
  /** Keep the diagram and draft readable when an operation fails. */
  function report(error: Diagnostic): void {
    // The error bar carries the reason; the status line only points to it.
    update({ problem: error, status: 'Action failed. See the error above.' });
  }
  function dismissRequest(id: string): void {
    const result = submissions.dismiss(id);
    if (!result.ok) return report(result.error);
    releaseDismissedCreation(id);
    definitions.released(id);
  }
  /** Workspace hints are reconciled through a full checked Authoring snapshot. */
  async function refresh(): Promise<void> {
    const read = ++snapshotRead;
    const response = await bindings.client.get('/api/v1/workspace?history=versions');
    if (read !== snapshotRead) return;
    receiveSnapshot(response);
  }
  /** Only the latest requested snapshot can advance transport generation, even when responses arrive out of order. */
  function receiveSnapshot(
    response: Awaited<ReturnType<WorkspaceBindings['client']['get']>>,
  ): void {
    if (!response.ok) {
      report(response.error);
      return;
    }
    if (!response.value.outcome.ok) {
      report(foreignFailure('service', response.value.outcome.error));
      return;
    }
    acceptSnapshot(response.value.outcome.value, response.value.generation);
  }
  /** Snapshot sequence prevents out-of-order reads from moving the sidebar backward. */
  function acceptSnapshot(
    input: unknown,
    generation: TransportGeneration,
  ): void {
    const checked = bindings.inputs.snapshot(input);
    if (!checked.ok) {
      report(checked.error);
      return;
    }
    const latest = checked.value;
    acceptCurrent(latest, generation);
  }
  /** A restarted service keeps drafts visible; new-generation data never silently advances a draft's captured preconditions. */
  function acceptCurrent(
    latest: LatestSnapshot,
    generation: TransportGeneration,
  ): void {
    if (staleSnapshot(state, latest.snapshot, generation)) return;
    settleChangedRender(latest, generation);
    update({
      snapshot: latest.snapshot,
      collections: latest.collections,
      generation: readGeneration(generation),
      connected: true,
    });
    historyGate = observeSnapshot(historyGate, latest.snapshot.sequence);
    restoreEdits();
    library.refresh(latest.snapshot, latest.collections);
    source.reconcile(latest.snapshot, generation);
    updateMutationAvailability();
    refreshActive();
    void refreshHistory();
  }
  /** A checked snapshot can invalidate the current request before it is allowed to install. */
  function settleChangedRender(
    latest: LatestSnapshot,
    generation: TransportGeneration,
  ): void {
    const request = rendering;
    if (request === null || !currentRequest(request)) return;
    settleInvalidated(request, renderInvalidation(request, latest, generation));
  }
  /** An invalidated request fails; one the snapshot still matches keeps going. */
  function settleInvalidated(
    request: RenderRequest,
    invalid: Diagnostic | null,
  ): void {
    if (invalid !== null) settleFailure(request, invalid);
  }
  /** Foreign commits request a new render only when the active collection revision changed. No update performs Fit. */
  function refreshActive(): void {
    const refreshed = activeRefresh(state, rendering);
    if (refreshed.kind === 'gone') return clearMissingActive(refreshed.active);
    if (refreshed.kind === 'reopen') void open(refreshed.id);
  }
  /** A collection that left the catalogue returns the view to the library. */
  function clearMissingActive(active: ActiveDiagram): void {
    active.session.dispose();
    update(gonePatch());
  }
  /** One latest render request owns delivery. Cancelled/superseded jobs cannot mount their results. */
  async function open(id: CollectionId): Promise<void> {
    await requestOpen(id, 'navigation');
  }
  /** Explicit choices supersede every older render; token checks decide delivery after transport aborts. */
  async function requestOpen(
    id: CollectionId,
    mode: RenderMode,
  ): Promise<void> {
    const request = beginRender(id, mode);
    if (request === null) return;
    const response = await bindings.client.get(
      `/api/v1/render?id=${encodeURIComponent(id)}`,
      request.job.signal,
    );
    deliverResponse(request, response);
  }
  /** Only the current request reads its response. */
  function deliverResponse(
    request: RenderRequest,
    response: Awaited<ReturnType<WorkspaceBindings['client']['get']>>,
  ): void {
    const document = currentRequest(request) ? receiveRender(response, request) : null;
    if (document === null) return;
    settleDocument(request, document);
  }
  function settleDocument(
    request: RenderRequest,
    document: Result<RenderDocument>,
  ): void {
    if (!document.ok) return settleFailure(request, document.error);
    finishRequest(request, document.value);
  }
  function finishRequest(
    request: RenderRequest,
    document: RenderDocument,
  ): void {
    if (!currentRequest(request)) return;
    const installed = installAdmitted(request, document);
    if (!installed.ok) return settleFailure(request, installed.error);
    settleSuccess(request);
  }
  function installAdmitted(
    request: RenderRequest,
    document: RenderDocument,
  ): Result<void> {
    const admission = admitRender(request, document);
    if (!admission.ok) return admission;
    return install(document);
  }
  /** A refused admission starts rereading the workspace before the failure settles. */
  function admitRender(
    request: RenderRequest,
    document: RenderDocument,
  ): Result<void> {
    const admission = renderAdmission(state, request, document);
    if (!admission.ok) void refresh();
    return admission;
  }
  /** A request captures the checked revision and service generation used for its admission. */
  function beginRender(
    id: CollectionId,
    mode: RenderMode,
  ): RenderRequest | null {
    if (disposed) return null;
    invalidateRender();
    const job = new AbortController();
    const request: RenderRequest = { token: ++requestToken, ...renderTicket(state, id, mode), job };
    rendering = request;
    update(openingPatch(state, request));
    return request;
  }
  /** Successful HTTP payloads require owner validation before Canvas sees them. */
  function receiveRender(
    response: Awaited<ReturnType<WorkspaceBindings['client']['get']>>,
    request: RenderRequest,
  ): Result<RenderDocument> {
    if (!response.ok) return response;
    return transportDocument(response.value, request);
  }
  /** A changed generation rereads the workspace; the service's own refusal passes through. */
  function transportDocument(
    response: TransportResponse,
    request: RenderRequest,
  ): Result<RenderDocument> {
    if (generationChanged(response.generation, request, state.generation))
      return generationMismatch();
    const outcome = wireOutcome('service', response.outcome);
    return outcome.ok ? readRender(outcome.value, request) : outcome;
  }
  /** Rereading starts before the failure settles. */
  function generationMismatch(): Result<RenderDocument> {
    void refresh();
    return generationFailure();
  }
  /** Selected collection identity must match the requested document, even if a delayed server returns another valid diagram. */
  function readRender(
    input: unknown,
    request: RenderRequest,
  ): Result<RenderDocument> {
    const document = bindings.inputs.diagram(input);
    if (!document.ok) return document;
    return documentFor(document.value, request);
  }
  /** Reuse the existing Canvas session for edits; only admitted documents may replace the retained scene. */
  function install(document: RenderDocument): Result<void> {
    const admitted = matchingSnapshot(document);
    if (!admitted.ok) return admitted;
    return installCurrent(admitted.value);
  }
  /** Bind the displayed document to its matching canonical snapshot before any edit can use its preconditions. */
  function installCurrent(admitted: AdmittedRender): Result<void> {
    const active = state.active;
    const reused = updateExisting(active, admitted);
    if (!reused.ok) return reused;
    if (reused.value) return { ok: true, value: undefined };
    return installNew(active, admitted);
  }
  function installNew(
    active: ActiveDiagram | null,
    { document, base, generation }: AdmittedRender,
  ): Result<void> {
    const session = bindings.sessions.open(document, effects);
    if (!session.ok) return session;
    retainCamera(active, session.value, document, base);
    update(
      installedPatch(
        state,
        {
          generation,
          document,
          base,
          canvas: bindings.sessions.canvas,
          session: session.value,
        },
        editStatus(),
        creationForOpenedCollection(active, document),
      ),
    );
    active?.session.dispose();
    updateLocation(document.collection.id);
    source.refreshReadout();
    updateMutationAvailability();
    return { ok: true, value: undefined };
  }
  /** Reuse is an explicit decision, not a type predicate: a valid active session may belong to another collection. */
  function updateExisting(
    active: ActiveDiagram | null,
    admitted: AdmittedRender,
  ): Result<boolean> {
    if (active === null) return { ok: true, value: false };
    if (!reusableSession(active, admitted.document, admitted.base))
      return { ok: true, value: false };
    return updateExistingSession(active, admitted);
  }
  function updateExistingSession(
    active: ActiveDiagram,
    admitted: AdmittedRender,
  ): Result<boolean> {
    const updated = updateCanvas(active, admitted);
    if (!updated.ok) return updated;
    return { ok: true, value: true };
  }
  /** A navigation failure is visible but does not undo a successfully opened diagram. */
  function updateLocation(id: CollectionId): void {
    library.visit(id);
    const result = bindings.navigation.opened({ kind: 'collection', collection: id });
    if (!result.ok) report(result.error);
  }
  /** Canvas admission and generation checks run before replacing the UI's document reference. */
  function updateCanvas(
    active: ActiveDiagram,
    admitted: AdmittedRender,
  ): Result<void> {
    const updated = bindings.sessions.update(active.session, admitted.document);
    if (!updated.ok) return updated;
    releaseConfirmed(active.session);
    update(reusedPatch(state, active, admitted, editStatus()));
    source.refreshReadout();
    updateMutationAvailability();
    return { ok: true, value: undefined };
  }
  /** A settled request clears only its own pending metadata and leaves a newer request untouched. */
  function settleSuccess(request: RenderRequest): void {
    if (!currentRequest(request)) return;
    rendering = null;
    update(openSuccessPatch(state, editStatus()));
    releaseHistory();
  }
  /** Failed chooser attempts are recoverable and never replace the retained active diagram. */
  function settleFailure(
    request: RenderRequest,
    error: Diagnostic,
  ): void {
    if (!currentRequest(request)) return;
    request.job.abort();
    rendering = null;
    update(openFailurePatch(state, request, error));
  }
  /** Transport aborts are an optimisation; invalidation is the ownership boundary. */
  function invalidateRender(): void {
    requestToken += 1;
    rendering?.job.abort();
    rendering = null;
  }
  function currentRequest(request: RenderRequest): boolean {
    return (
      !disposed &&
      requestToken === request.token &&
      rendering === request &&
      !request.job.signal.aborted
    );
  }
  /** Mutations wait for the scene's own transport generation and any in-flight request; navigation stays available. */
  function updateMutationAvailability(): void {
    const active = state.active;
    if (active === null) return;
    active.session.dispatch({
      kind: 'mutation-available',
      value: mutationAvailable(active, state.generation, {
        // A review is applied only while held, so a held review alone holds edits.
        movement: movementSlot !== null,
        history: historyBlocked(),
      }),
    });
  }
  /** An open, unapplied editor form in this collection means "Draft not applied", never "Saved". */
  function editStatus(): string {
    return editingStatus(state, openDraftCount(state.active, editorDrafts()));
  }
  /** Every editor's drafts, whichever collection they belong to. */
  function editorDrafts(): readonly CollectionDraft[] {
    return [inspector, wires, definitions].flatMap(
      (editor): readonly CollectionDraft[] => editor.getSnapshot().drafts,
    );
  }
  /** Opening, editing or discarding a form moves a resting status; progress and failure messages stay. */
  function refreshRestingStatus(): void {
    const next = restingStatus(state.status, editStatus());
    if (next !== null) update({ status: next });
  }
  /** Interaction effects are consumed exactly once; semantic/appearance editing still goes through Model then Authoring. */
  function effects(items: readonly CanvasEffect[]): void {
    items.forEach(effect);
  }
  /** Inspect requests open the existing panel explicitly; ordinary selection never changes its visibility or camera. */
  function effect(item: CanvasEffect): void {
    if (item.kind === 'inspect-request') {
      bindings.panels.open('right', true);
      return;
    }
    if (item.kind === 'edit-intent') void editCanvas(item.intent);
  }

  /** Publishes the held review, or its absence, with any other view change. */
  function showMovement(
    next: MovementSlot,
    patch: Partial<WorkspaceView> = {},
  ): void {
    movementSlot = next;
    update({ movementReview: next?.shown ?? null, ...patch });
  }
  async function handleMovementReview(
    active: ActiveDiagram,
    intent: Extract<EditIntent, { kind: 'placement' }>,
  ): Promise<boolean> {
    const moveReview = bindings.moveReview;
    if (moveReview === undefined) return false;
    return reviewMovement(active, intent, moveReview);
  }
  async function reviewMovement(
    active: ActiveDiagram,
    intent: Extract<EditIntent, { kind: 'placement' }>,
    moveReview: NonNullable<WorkspaceBindings['moveReview']>,
  ): Promise<boolean> {
    if (!reviewableMovement(active.document, intent)) return false;
    const reviewed = moveReview(active.document, intent, active.session.getSnapshot().stamp);
    if (!reviewed.ok) return rejectMovement(active, intent, reviewed.error);
    return handleReviewedMovement(active, intent, reviewed.value);
  }
  /** Model's review decides; the session discards, holds, sends or refuses the gesture. */
  function handleReviewedMovement(
    active: ActiveDiagram,
    intent: Extract<EditIntent, { kind: 'placement' }>,
    review: MoveReview,
  ): boolean {
    const outcome = reviewOutcome(review);
    switch (outcome.kind) {
      case 'discard':
        // Nothing changed (e.g. dropped back in place): the node returns quietly.
        active.session.dispatch({ kind: 'discard', id: intent.id });
        return true;
      case 'retain':
        return retainMovementReview(active, intent, review, outcome.option);
      case 'submit':
        void submitFeasibleCanvas(active, intent, outcome.option.changes, outcome.option.preview);
        return true;
      case 'reject':
        return rejectMovement(active, intent, outcome.error);
    }
  }
  function rejectMovement(
    active: ActiveDiagram,
    intent: Extract<EditIntent, { kind: 'placement' }>,
    error: Diagnostic,
  ): boolean {
    active.session.dispatch({ kind: 'reject', id: intent.id, message: error.message });
    report(error);
    return true;
  }
  /** Held before the scene shows its preview, so a gesture arriving meanwhile is refused. */
  function retainMovementReview(
    active: ActiveDiagram,
    intent: Extract<EditIntent, { kind: 'placement' }>,
    review: MoveReview,
    option: MoveOption,
  ): boolean {
    const capture = { active, intent, review, workspace: snapshotScope(state.snapshot) };
    const held = heldMovement(capture, option.id);
    movementSlot = held;
    const accepted = active.session.dispatch({
      kind: 'preview-routes',
      id: intent.id,
      ...option.preview,
    });
    if (!accepted.ok || accepted.value.state.routePreview?.gesture !== intent.id) {
      movementSlot = null;
      return rejectMovement(active, intent, previewRefused());
    }
    showMovement(held, { status: 'Review movement options' });
    updateMutationAvailability();
    return true;
  }
  function rejectWhileMovementActive(intent: EditIntent): void {
    const error = movementActive();
    if (intent.kind === 'placement' && state.active !== null)
      state.active.session.dispatch({ kind: 'reject', id: intent.id, message: error.message });
    report(error);
  }
  function planAndSubmit(
    active: ActiveDiagram,
    intent: EditIntent,
  ): void {
    const planned = bindings.edits.plan(intent, {
      document: active.document,
      stamp: active.session.getSnapshot().stamp,
    });
    if (!planned.ok) return report(planned.error);
    void submitFeasibleCanvas(active, intent, planned.value);
  }
  /** A busy client retains subsequent gestures as recoverable drafts; no second browser request is submitted concurrently. */
  async function editCanvas(intent: EditIntent): Promise<void> {
    if (movementSlot !== null) {
      rejectWhileMovementActive(intent);
      return;
    }
    const active = state.active;
    if (active === null) return;
    await continueCanvasEdit(active, intent);
  }
  async function continueCanvasEdit(
    active: ActiveDiagram,
    intent: EditIntent,
  ): Promise<void> {
    if (intent.kind === 'connection') {
      beginConnection(active, intent);
      return;
    }
    if (await reviewPlacementIfSupported(active, intent)) return;
    planAndSubmit(active, intent);
  }
  function beginConnection(
    active: ActiveDiagram,
    intent: Extract<EditIntent, { kind: 'connection' }>,
  ): void {
    const section = resolveConnectionSection(active, intent, connectionCapture !== null);
    if (!section.ok) return report(section.error);
    const draft = buildConnectionDraft(connectionPolicy, active, intent, section.value);
    if (!draft.ok) return report(draft.error);
    connectionCapture = { draft: draft.value, request: null };
    bindings.panels.open('right', true);
    update({ connection: draft.value, status: 'Review new connection', problem: null });
  }
  async function reviewPlacementIfSupported(
    active: ActiveDiagram,
    intent: EditIntent,
  ): Promise<boolean> {
    if (intent.kind !== 'placement') return false;
    return handleMovementReview(active, intent);
  }
  /** Reject infeasible local geometry before any Authoring submission; retain the human draft. */
  function movementPreview(
    active: ActiveDiagram,
    intent: EditIntent,
    changes: readonly import('../../contract/records/owners.js').Change[],
    acceptedPreview?: GeometryPreview,
  ): Result<GeometryPreview | null> {
    return previewAcceptedOrRoutes(active, intent, changes, acceptedPreview);
  }
  function previewAcceptedOrRoutes(
    active: ActiveDiagram,
    intent: EditIntent,
    changes: readonly import('../../contract/records/owners.js').Change[],
    acceptedPreview: GeometryPreview | undefined,
  ): Result<GeometryPreview | null> {
    if (acceptedPreview !== undefined) return { ok: true, value: acceptedPreview };
    return previewMovementRoutes(active, intent, changes);
  }
  function previewMovementRoutes(
    active: ActiveDiagram,
    intent: EditIntent,
    changes: readonly import('../../contract/records/owners.js').Change[],
  ): Result<GeometryPreview | null> {
    return bindings.previewRoutes?.(active.document, intent, changes) ?? { ok: true, value: null };
  }
  function rejectPreview(
    active: ActiveDiagram,
    intent: EditIntent,
    preview: Extract<Result<GeometryPreview | null>, { ok: false }>,
  ): Result<Receipt> {
    active.session.dispatch({ kind: 'reject', id: intent.id, message: preview.error.message });
    report(preview.error);
    rejectMovementPreview(intent.id);
    return { ok: false, error: preview.error };
  }
  function rejectMovementPreview(intentId: string): void {
    const held = heldFor(movementSlot, intentId);
    if (held === null) return;
    showMovement(inPhase(held, 'rejected'));
    updateMutationAvailability();
  }
  function retainInitialPreview(
    active: ActiveDiagram,
    intent: EditIntent,
    preview: GeometryPreview | null,
    start: number,
  ): void {
    if (preview !== null) publishPreview(active, intent, preview, start);
  }
  /** A send that may still land keeps the review uncertain; otherwise it settles. */
  function updateFailedMovement(
    held: MovementHeld,
    active: ActiveDiagram,
    preview: GeometryPreview | null,
    start: number,
  ): void {
    const { intent } = held.capture;
    const retained = state.pending.find((item) => item.request.request === intent.id);
    if (savingRequest(retained)) return retainUncertainMovement(held);
    settleFailedMovement(held, active, preview, start, retained?.state === 'rejected');
  }
  /** The scene is asked to restore the preview; a refused request or a lost preview leaves it refused. */
  function settleFailedMovement(
    held: MovementHeld,
    active: ActiveDiagram,
    preview: GeometryPreview | null,
    start: number,
    rejected: boolean,
  ): void {
    const restored = restoreMovementPreview(active, held.capture.intent, preview, start);
    showMovement(inPhase(held, failedPhase(rejected, restored)));
    updateMutationAvailability();
  }
  function restoreMovementPreview(
    active: ActiveDiagram,
    intent: PlacementIntent,
    preview: GeometryPreview | null,
    start: number,
  ): boolean {
    return preview !== null && publishPreview(active, intent, preview, start);
  }
  async function submitFeasibleCanvas(
    active: ActiveDiagram,
    intent: EditIntent,
    changes: readonly import('../../contract/records/owners.js').Change[],
    acceptedPreview?: GeometryPreview,
  ): Promise<Result<Receipt> | null> {
    const start = performance.now();
    const preview = movementPreview(active, intent, changes, acceptedPreview);
    if (!preview.ok) return rejectPreview(active, intent, preview);
    const submission = submitCanvas(active, intent, changes);
    const retainedAtStart = state.pending.find(
      (item) => item.request.request === intent.id && item.state === 'sending',
    );
    if (retainedAtStart !== undefined) retainInitialPreview(active, intent, preview.value, start);
    const result = await submission;
    updateMovementAfterSubmission(result, intent, active, preview.value, start);
    return result;
  }
  /** A failed send updates the review only while it is still held for this gesture. */
  function updateMovementAfterSubmission(
    result: Result<Receipt>,
    intent: EditIntent,
    active: ActiveDiagram,
    preview: GeometryPreview | null,
    start: number,
  ): void {
    const held = heldFor(movementSlot, intent.id);
    if (result.ok || held === null) return;
    updateFailedMovement(held, active, preview, start);
  }
  /** Measure only inspected routes accepted by the Canvas gesture currently awaiting confirmation. */
  function publishPreview(
    active: ActiveDiagram,
    intent: EditIntent,
    geometry: GeometryPreview,
    start: number,
  ): boolean {
    const accepted = active.session.dispatch({
      kind: 'preview-routes',
      id: intent.id,
      ...geometry,
    });
    if (!accepted.ok) return false;
    if (accepted.value.state.routePreview?.gesture !== intent.id) return false;
    performance.measure('canvas:released-route-preview', {
      start,
      end: performance.now(),
      detail: { gesture: intent.id },
    });
    return true;
  }
  /** Capture the snapshot shown with the gesture; changing versions later is never part of retry. */
  async function submitCanvas(
    active: ActiveDiagram,
    intent: EditIntent,
    changes: readonly import('../../contract/records/owners.js').Change[],
  ): Promise<Result<Receipt>> {
    const request = bindings.inputs.model(
      active.base,
      active.document.collection.id,
      changes,
      intent.id,
    );
    if (!request.ok) {
      report(request.error);
      return request;
    }
    return submit(request.value, active.generation, state.sourceEdit, intent.id);
  }
  function rejectBlocked(
    request: Request,
    gesture: string | null,
  ): Result<void> {
    const allowed = submissionAllowed(historyGate, state.pending, request);
    if (allowed.ok) return allowed;
    report(allowed.error);
    if (gesture !== null) rejectGesture(gesture, allowed.error.message);
    return allowed;
  }
  /** Submission owns the durable journal and receipt checks; UI retains all drafts on failure. */
  async function submit(
    request: Request,
    generation: TransportGeneration,
    sourceEdit: number,
    gesture: string | null,
  ): Promise<Result<Receipt>> {
    const allowed = rejectBlocked(request, gesture);
    if (!allowed.ok) return allowed;
    update({ status: 'Saving…', problem: null });
    const result = await submissions.submit({ request, generation, sourceEdit, gesture });
    if (!result.ok) handleSubmitFailure(result.error, gesture);
    return result;
  }
  /** Sends under the latest read generation; before the first read nothing is sent (`not-read`). */
  async function submitCurrent(request: Request): Promise<Result<Receipt>> {
    const generation = currentGeneration(state.generation);
    if (!generation.ok) {
      report(generation.error);
      return generation;
    }
    return submit(request, generation.value, state.sourceEdit, null);
  }
  function handleSubmitFailure(
    error: Diagnostic,
    gesture: string | null,
  ): void {
    report(error);
    void refresh();
    if (gesture !== null) handleGestureFailure(error, gesture);
  }
  function handleGestureFailure(
    error: Diagnostic,
    gesture: string,
  ): void {
    const held = heldFor(movementSlot, gesture);
    const retained = state.pending.find((item) => item.request.request === gesture);
    if (held !== null && savingRequest(retained)) return retainUncertainMovement(held);
    rejectGesture(gesture, error.message);
    settleGestureFailure(held, retained?.state === 'rejected');
  }
  /** The held review returns to review, or stays refused when the request was refused. */
  function settleGestureFailure(
    held: MovementHeld | null,
    rejected: boolean,
  ): void {
    if (held === null) return;
    showMovement(inPhase(held, rejected ? 'rejected' : 'review'));
    updateMutationAvailability();
  }
  function retainUncertainMovement(held: MovementHeld): void {
    showMovement(requestedIn(held, 'uncertain'));
  }
  function rejectGesture(
    gesture: string,
    message: string,
  ): void {
    state.active?.session.dispatch({ kind: 'reject', id: gesture, message });
  }
  /** Only a matching Authoring receipt may acknowledge a gesture or mark its submitted source generation saved. */
  function confirmed(
    submission: Submission,
    receipt: Receipt,
    carriedSnapshot?: CarriedSnapshot,
  ): void {
    source.confirmed(submission, receipt);
    update({ status: editStatus() });
    definitions.confirmed(submission.request.request);
    confirmGesture(submission.gesture);
    clearConfirmedMovement(submission.gesture);
    settleConfirmedCreation(submission.request.request);
    finishConfirmedSubmission(submission, receipt, carriedSnapshot);
  }
  /** A confirmed request empties the Add forms that sent it; the connection it sent closes too. */
  function settleConfirmedCreation(requestId: string): void {
    const settled = settledCaptures(creationCaptures, requestId);
    creationCaptures = settled.captures;
    settleConnectionCapture(requestId);
    if (settled.cleared.length === 0) return;
    const locked = creationLocked(creationCaptures);
    update({ creation: settledCreation(state.creation, settled.cleared, locked) });
  }
  function settleConnectionCapture(requestId: string): void {
    if (connectionCapture?.request?.request !== requestId) return;
    connectionCapture = null;
    update({ connection: null });
  }
  function clearConfirmedMovement(gesture: string | null): void {
    if (heldFor(movementSlot, gesture) === null) return;
    showMovement(null);
    updateMutationAvailability();
  }
  /** Installs after the confirmation above, so a source draft rebases across its own receipt. */
  function finishConfirmedSubmission(
    submission: Submission,
    receipt: Receipt,
    carriedSnapshot: CarriedSnapshot | undefined,
  ): void {
    if (submission.request.intent.kind !== 'change')
      void finishHistory(receipt.sequence, carriedSnapshot);
    else void catchUp(carriedSnapshot);
  }
  /** An apply answer's carried snapshot is installed as a workspace read would be; a receipt lookup carries none, so reread. */
  function catchUp(carriedSnapshot: CarriedSnapshot | undefined): Promise<void> {
    if (carriedSnapshot === undefined || state.generation.kind === 'unread') return refresh();
    acceptCurrent(carriedSnapshot, state.generation.generation);
    return Promise.resolve();
  }
  /** Canvas is notified only when the receipt belongs to a submitted gesture. */
  function confirmGesture(gesture: string | null): void {
    if (gesture === null) return;
    confirmedGestures.add(gesture);
    if (state.active !== null) releaseConfirmed(state.active.session);
  }
  /** Receipt alone cannot remove a drag preview while the canvas still displays the old revision. */
  function releaseConfirmed(session: ActiveDiagram['session']): void {
    const snapshot = session.getSnapshot();
    const retained = snapshot.recovery.filter(
      (item) =>
        confirmedGestures.has(item.draft.id) && snapshot.stamp.revision > item.draft.base.revision,
    );
    for (const item of retained) {
      session.dispatch({ kind: 'confirmed', id: item.draft.id });
      confirmedGestures.delete(item.draft.id);
    }
  }
  /** A response racing a newer snapshot is discarded; old rendered data never gains new write preconditions. */
  function matchingSnapshot(document: RenderDocument): Result<AdmittedRender> {
    const base = snapshotBase(state, document);
    if (!base.ok) void refresh();
    return base;
  }
  /** Human creation is an ordinary DSL creation with absent collection and observed catalog preconditions. */
  async function create(title: string): Promise<void> {
    if (state.snapshot === null) return;
    const id = bindings.ids.collectionId();
    if (!id.ok) return report(id.error);
    await createCollection(state.snapshot, id.value, title);
  }
  /** The new collection's starter source, created against the catalogue `snapshot` read. */
  async function createCollection(
    snapshot: Snapshot,
    id: CollectionId,
    title: string,
  ): Promise<void> {
    const source = bindings.inputs.newSource(id, title);
    const request = bindings.inputs.dsl(snapshot, id, source, 'create', bindings.nextId());
    if (!request.ok) return report(request.error);
    await createSubmitted(request.value, id);
  }
  /** Open only after a confirmed creation, whose answer installed the snapshot listing it; a failed create keeps the current canvas. */
  async function createSubmitted(
    request: Request,
    id: CollectionId,
  ): Promise<void> {
    const result = await submitCurrent(request);
    if (!result.ok) return;
    await open(id);
  }
  /** The inspector supplies a captured base and typed replacement; the same Authoring request journal owns its write. */
  async function applyObject(
    draft: ObjectDraft,
    object: DiagramObject,
  ): Promise<Result<Receipt>> {
    return applyChanges(draft, [{ op: 'replace', target: 'objects', value: object }]);
  }
  function retainDefinitionRequest(
    draft: DefinitionDraft,
    request: Request,
  ): Result<Request> {
    if (draft.request !== undefined) return { ok: true, value: request };
    const retained = definitions.bindRequest(draft.key, request);
    if (!retained.ok) return retained;
    return { ok: true, value: request };
  }
  async function applyDefinition(draft: DefinitionDraft): Promise<Result<Receipt>> {
    const request = definitionRequest(draft, bindings);
    if (!request.ok) {
      definitions.unlockWithoutRequest(draft.key);
      return request;
    }
    const retained = retainDefinitionRequest(draft, request.value);
    if (!retained.ok) {
      definitions.unlockWithoutRequest(draft.key);
      return retained;
    }
    return submit(retained.value, draft.generation, state.sourceEdit, null);
  }
  /** Captured Model changes share request assembly; their feature decides the semantic change list. */
  async function applyChanges(
    draft: Pick<ObjectDraft | DefinitionDraft, 'base' | 'collection' | 'generation'>,
    changes: readonly import('../../contract/records/owners.js').Change[],
  ): Promise<Result<Receipt>> {
    const request = bindings.inputs.model(
      draft.base,
      draft.collection.id,
      changes,
      bindings.nextId(),
    );
    if (!request.ok) return request;
    return submit(request.value, draft.generation, state.sourceEdit, null);
  }
  /** Add keeps diagram and object creation on the existing Model → Authoring receipt path. */
  async function addDiagram(draft: AddDiagramDraft): Promise<Result<Receipt>> {
    const target = diagramTarget(state.active, state.snapshot, draft);
    if (!target.ok) return retainCreationFailure(target);
    const captured = capturedDiagram(target.value);
    if (!captured.ok) return retainCreationFailure(captured);
    update({
      creation: { ...state.creation, diagram: draft, problem: null, busy: true, adding: 'diagram' },
    });
    const changes = diagramChanges(captured.value, draft);
    const result = await submitCreation('diagram', captured.value, changes);
    return finishCreation(result, 'diagram');
  }
  /** New objects are created once; reuse only adds a section-local appearance of the same ID. */
  async function addObject(draft: AddObjectDraft): Promise<Result<Receipt>> {
    const target = capturedContext('object', draft.section);
    if (!target.ok) return retainCreationFailure(target);
    update({
      creation: { ...state.creation, object: draft, problem: null, busy: true, adding: 'object' },
    });
    const changes = objectChanges(target.value, draft, target.value.capture.id);
    if (!changes.ok) return retainCreationFailure(changes);
    const result = await submitCreation('object', target.value.capture, changes.value);
    return finishCreation(result, 'object');
  }
  /** A group draft is checked before the form turns busy, so a refused draft never shows as adding. */
  async function addGroup(draft: AddGroupDraft): Promise<Result<Receipt>> {
    const target = capturedContext('group', draft.section);
    if (!target.ok) return retainCreationFailure(target);
    const changes = groupChanges(target.value.section, draft, target.value.capture.id);
    if (!changes.ok) return retainCreationFailure(changes);
    update({
      creation: { ...state.creation, group: draft, problem: null, busy: true, adding: 'group' },
    });
    const result = await submitCreation('group', target.value.capture, changes.value);
    return finishCreation(result, 'group');
  }
  /** The Diagram form's capture while it belongs to the open collection. Fails with
   * `id-unavailable` or `invalid-creation`. */
  function capturedDiagram(active: ActiveDiagram) {
    const capture = captureCreation('diagram', active);
    if (!capture.ok) return capture;
    return capturedIn(capture.value, active);
  }
  /** The diagram an object or group goes to, with the form's capture there. Fails with
   * `invalid-creation` or `id-unavailable`. */
  function capturedContext<K extends 'object' | 'group'>(
    kind: K,
    section: AddObjectDraft['section'],
  ) {
    const context = creationContext(state.active, creationCaptures[kind], section);
    if (!context.ok) return context;
    const capture = captureCreation(kind, context.value.active);
    if (!capture.ok) return capture;
    return { ok: true as const, value: { ...context.value, capture: capture.value } };
  }
  /** The first submit builds the request and keeps it on the capture; a retry resends that same body. */
  async function submitCreation(
    kind: CreationKind,
    capture: CreationCapture<unknown>,
    changes: readonly Change[],
  ): Promise<Result<Receipt>> {
    const request =
      capture.request === null
        ? bindings.inputs.model(capture.base, capture.collection.id, changes, bindings.nextId())
        : { ok: true as const, value: capture.request };
    if (!request.ok) return retainCreationFailure(request);
    creationCaptures = withRequest(creationCaptures, kind, request.value);
    return submit(request.value, capture.generation, state.sourceEdit, null);
  }
  /** The capture's collection is read before settling, since settling may release the capture. */
  function finishCreation(
    result: Result<Receipt>,
    kind: CreationKind,
  ): Result<Receipt> {
    const origin = creationCaptures[kind]?.collection;
    settleCreation(result, kind);
    settleCreationElsewhere(origin, result);
    return result;
  }
  /** A landed add empties its form; a refused one keeps the draft and shows why. */
  function settleCreation(
    result: Result<Receipt>,
    kind: CreationKind,
  ): void {
    if (!result.ok) return settleRefusedCreation(result.error, kind);
    creationCaptures = released(creationCaptures, kind);
    update({ creation: addedCreation(state.creation, kind) });
  }
  /** A refused or unsent add changed nothing, so the next submit rebuilds its request from the
   * current draft; an uncertain request keeps its capture so a retry cannot add the item twice. */
  function settleRefusedCreation(
    error: Diagnostic,
    kind: CreationKind,
  ): void {
    creationCaptures = refusedCaptures(creationCaptures, kind, state.pending);
    const locked = creationLocked(creationCaptures);
    update({
      creation: { ...state.creation, problem: plainMessage(error.message), busy: locked },
    });
  }
  /** Another collection opened while this add was in flight: its forms start empty and its refusal is not shown there. */
  function settleCreationElsewhere(
    origin: Collection | undefined,
    result: Result<Receipt>,
  ): void {
    if (!landedElsewhere(origin, state.active, creationCaptures)) return;
    update({ creation: freshCreation() });
    if (!result.ok) reportRefusedElsewhere(origin, result.error);
  }
  function reportRefusedElsewhere(
    origin: Collection,
    error: Diagnostic,
  ): void {
    const note = refusedElsewhereNote(origin.title, error.message);
    // Clearing the bar first dismisses the refused request; the note then stays on the Add form.
    update({ problem: null });
    update({ status: note, creation: { ...state.creation, problem: note } });
  }
  function retainCreationFailure<T>(
    result: Extract<Result<T>, { ok: false }>,
  ): Extract<Result<T>, { ok: false }> {
    update({
      creation: { ...state.creation, problem: plainMessage(result.error.message), busy: false },
    });
    return result;
  }
  function setDiagramDraft(draft: AddDiagramDraft): void {
    if (creationLocked(creationCaptures)) return;
    captureDraft('diagram');
    update({ creation: { ...state.creation, diagram: draft, problem: null } });
  }
  function setObjectDraft(draft: AddObjectDraft): void {
    if (creationLocked(creationCaptures)) return;
    captureDraft('object');
    update({ creation: { ...state.creation, object: draft, problem: null } });
  }
  function setGroupDraft(draft: AddGroupDraft): void {
    if (creationLocked(creationCaptures)) return;
    captureDraft('group');
    update({ creation: { ...state.creation, group: draft, problem: null } });
  }
  function cancelCreation(kind: CreationKind): void {
    if (creationLocked(creationCaptures)) return;
    creationCaptures = released(creationCaptures, kind);
    update({ creation: cancelledCreation(state.creation, kind) });
  }
  function editConnection(edit: ConnectionEdit): void {
    const capture = connectionCapture;
    if (capture === null || capture.request !== null) return;
    const next = editedConnection(capture.draft, edit);
    connectionCapture = { draft: next, request: null };
    update({ connection: next, problem: null });
  }
  async function applyConnection(): Promise<Result<Receipt>> {
    const review = reviewConnection(connectionCapture, state.active);
    if (!review.ok) return retainConnectionFailure(connectionCapture?.draft, review.error);
    return submitConnectionRequest(review.value);
  }
  function retainConnectionFailure(
    draft: ConnectionDraft | undefined,
    error: Diagnostic,
  ): Result<Receipt> {
    if (draft !== undefined)
      update({ connection: connectionProblem(state.connection, draft, error), problem: error });
    return { ok: false, error };
  }
  async function submitConnectionRequest(review: ConnectionReview): Promise<Result<Receipt>> {
    const draft = review.capture.draft;
    const request = connectionRequest(connectionPolicy, bindings, draft, review.label);
    if (!request.ok) {
      update({
        connection: connectionProblem(state.connection, draft, request.error),
        problem: request.error,
      });
      return request;
    }
    const retained = review.capture.request ?? request.value;
    connectionCapture = { draft, request: retained };
    update({ connection: { ...draft, requestState: 'sending' } });
    const result = await submit(retained, draft.generation, state.sourceEdit, draft.id);
    if (!result.ok)
      update({
        connection: connectionProblem(state.connection, draft, result.error),
        problem: result.error,
      });
    return result;
  }
  function cancelConnection(): void {
    if (connectionCapture?.request !== null) return;
    connectionCapture = null;
    update({ connection: null, problem: null, status: editStatus() });
  }
  /** A dismissed add or connection request unlocks the Add forms; the connection is tried only when no add sent it. */
  function releaseDismissedCreation(requestId: string): void {
    if (releaseCreationRequest(requestId) || releaseConnectionRequest(requestId))
      clearDismissedCreationView();
  }
  /** Releases the add capture that sent this request; false when none did. */
  function releaseCreationRequest(requestId: string): boolean {
    const dismissed = dismissedCaptures(creationCaptures, requestId);
    if (dismissed === null) return false;
    creationCaptures = dismissed;
    return true;
  }
  /** Returns the connection that sent this request to editing; false when it did not send it. */
  function releaseConnectionRequest(requestId: string): boolean {
    const releasedCapture = releasedConnection(connectionCapture, requestId);
    if (releasedCapture === null) return false;
    connectionCapture = releasedCapture;
    update({ connection: releasedCapture.draft });
    return true;
  }
  function clearDismissedCreationView(): void {
    update({ creation: { ...state.creation, problem: null, busy: false } });
  }
  /** The first edit of a form captures it against the open diagram; with nothing open there is
   * nothing to capture. A capture with no ID is not kept; the submit tries again and shows the
   * failure on the form. */
  function captureDraft(kind: CreationKind): void {
    const activeDiagram = state.active;
    if (activeDiagram !== null) captureCreation(kind, activeDiagram);
  }
  /** The form's capture, kept for later edits and submits; its ID is taken only when first made.
   * Fails with the ID source's `id-unavailable`, and nothing is kept. */
  function captureCreation<K extends CreationKind>(
    kind: K,
    activeDiagram: ActiveDiagram,
  ) {
    const capture = captureFor(creationCaptures, kind, activeDiagram, creationIds[kind]);
    if (capture.ok) creationCaptures = holding(creationCaptures, kind, capture.value);
    return capture;
  }
  /** Add forms belong to one collection: a newly opened one starts with empty forms and no error.
   * A newer revision of the same collection keeps them; a creation in flight keeps its form until it settles. */
  function creationForOpenedCollection(
    active: ActiveDiagram | null,
    document: RenderDocument,
  ): WorkspaceView['creation'] {
    if (active?.document.collection.id === document.collection.id) return state.creation;
    return creationLocked(creationCaptures) ? state.creation : freshCreation();
  }
  /** Every form released and emptied, for a collection the forms do not belong to yet. */
  function freshCreation(): WorkspaceView['creation'] {
    creationCaptures = noCaptures;
    return emptyCreation();
  }
  /** Library commands use the same durable request journal and captured catalog versions as diagram editing. */
  async function applyLibrary(
    base: import('../../contract/records/owners.js').Snapshot,
    changes: readonly import('@novakai/canvas-library').OrganisationChange[],
  ): Promise<Result<Receipt>> {
    const request = bindings.inputs.library(base, changes, bindings.nextId());
    if (!request.ok) return request;
    return submitCurrent(request.value);
  }
  /** Opening the chooser is a presentation intent; it never disposes the retained Canvas session. */
  function beginCollectionSwitch(): void {
    if (state.collectionSwitch.phase === 'loading') return;
    invalidateRender();
    update(choosingPatch(state));
  }
  /** Cancellation invalidates transport ownership before closing the controlled dialog. */
  function cancelCollectionSwitch(): void {
    if (state.collectionSwitch.phase === 'idle') return;
    invalidateRender();
    update(closedSwitchPatch(state, editStatus()));
    refreshActive();
    void refreshHistory();
  }
  /** A newer explicit target always supersedes an older target, including an in-flight request. */
  function chooseCollection(id: CollectionId): void {
    const plan = choosePlan(state, id);
    if (plan === 'cancel') return cancelCollectionSwitch();
    if (plan === 'begin') beginCollectionSwitch();
    void requestOpen(id, 'chooser');
  }
  /** Retry uses the failed target but captures the current snapshot and generation again. */
  function retryCollectionSwitch(): void {
    if (state.collectionSwitch.phase !== 'failed') return;
    chooseCollection(state.collectionSwitch.targetId);
  }
  /** Returning to discovery retains source and inspector drafts but disposes the old viewing session. */
  function showLibrary(): void {
    invalidateRender();
    update({ collectionSwitch: { phase: 'idle', activeId: null } });
    state.active?.session.dispose();
    source.close('keep');
    update({ active: null, opening: null });
    const location = bindings.navigation.opened({ kind: 'library' });
    if (!location.ok) report(location.error);
  }
  /** Connection hints affect controls, not saved state. A reconnect rereads owners and leaves pending requests untouched. */
  function connection(connected: boolean): void {
    update({ connected });
    state.active?.session.dispatch({ kind: 'connected', value: connected });
  }
  /** Mount and unmount own the event stream; no global listener survives disposal. */
  async function startWorkspace(): Promise<void> {
    await refresh();
    if (disposed) return;
    restoreEdits();
    await restoreLocation();
  }
  function markReady(): void {
    if (!state.sourceDirty) update({ status: 'Ready' });
  }
  async function start(): Promise<void> {
    removeHistoryKeys = bindHistoryKeys(navigateHistory);
    await startWorkspace();
    if (disposed) return;
    unsubscribe = bindings.client.changes(committedChange, connection);
    markReady();
  }
  /** A (re)connect names no commit, so it rereads. A commit rereads only past the installed sequence and when it is not
   * this browser's request still awaiting its answer; that answer installs it, even if the event arrives first.
   */
  function committedChange(commit: CommitNotice | null): void {
    if (commit === null || unseenForeignCommit(commit)) void refresh();
  }
  function unseenForeignCommit(commit: CommitNotice): boolean {
    return commit.sequence > (state.snapshot?.sequence ?? -1) && !awaitingAnswer(commit.request);
  }
  /** Only a request still sending gets an answer; an uncertain one's commit is installed by nobody else. */
  function awaitingAnswer(request: CommitNotice['request']): boolean {
    return state.pending.some(
      (item) => item.request.request === request && item.state === 'sending',
    );
  }
  /** A saved collection link restores the actual canonical diagram, including human placement records. */
  async function restoreLocation(): Promise<void> {
    const location = bindings.navigation.current();
    if (!location.ok) {
      report(location.error);
      return;
    }
    if (location.value.kind === 'collection') await open(location.value.collection);
  }
  /** Startup recovery is tied to the checked workspace identity; it makes no mutation request. */
  function restoreEdits(): void {
    if (state.snapshot === null) return;
    if (inWorkspace(restoredScope, state.snapshot.workspace)) return;
    restoredScope = restoredWorkspace(state.snapshot.workspace);
    bindings.panels.restore(state.snapshot.workspace);
    submissions.restore(state.snapshot.workspace);
    void reconcileHistory();
    source.restore(state.snapshot.workspace);
    inspector.restore(state.snapshot.workspace);
    definitions.restore(state.snapshot.workspace);
    wires.restore(state.snapshot.workspace);
  }
  /** Human-triggered reconciliation is read-only and makes missing confirmation explicit. */
  async function reconcileRequest(id: string): Promise<void> {
    const result = await submissions.reconcile(id);
    if (!result.ok) {
      report(result.error);
      return;
    }
    handleReconciliationResult(result.value, id);
  }
  function handleReconciliationResult(
    receipt: Receipt | null,
    id: string,
  ): void {
    clearSettledUncertainty();
    if (receipt === null) update({ status: 'No receipt found — retry remains an explicit action' });
    else settleConfirmedCreation(id);
  }
  /** "Could not be confirmed" is stale once no request remains unconfirmed. */
  function clearSettledUncertainty(): void {
    const stale = staleUncertainty(state);
    if (stale === null) return;
    update({ problem: null, creation: creationWithout(plainMessage(stale.message)) });
  }
  function creationWithout(message: string): WorkspaceView['creation'] {
    return state.creation.problem === message
      ? { ...state.creation, problem: null }
      : state.creation;
  }
  /** Retry retains the exact request body while using the current authenticated transport session. */
  async function retryRequest(id: string): Promise<void> {
    const result = await retryCurrent(id);
    if (!result.ok) report(result.error);
    else settleRetried(id);
    updateMovementRecovery(id);
  }
  /** Resends under the latest read generation; before the first read nothing is sent (`not-read`). */
  async function retryCurrent(id: string): Promise<Result<Receipt>> {
    const generation = currentGeneration(state.generation);
    if (!generation.ok) return generation;
    return submissions.retry(id, generation.value);
  }
  function settleRetried(id: string): void {
    clearSettledUncertainty();
    settleConfirmedCreation(id);
  }
  function updateMovementRecovery(requestId: string): void {
    const held = heldFor(movementSlot, requestId);
    if (held !== null) recoverMovement(held);
  }
  /** The journal moves the held review; a refusal releases edits again. */
  function recoverMovement(held: MovementHeld): void {
    const { intent } = held.capture;
    const pending = state.pending.find((item) => item.request.request === intent.id);
    const phase = recoveryPhase(pending);
    if (phase === null) return;
    showMovement(requestedIn(held, phase));
    if (phase === 'rejected') updateMutationAvailability();
  }
  /** Status reads never change navigation; stale responses cannot replace newer status. */
  async function refreshHistory(): Promise<void> {
    const token = ++historyRead;
    const response = await bindings.client.get('/api/v1/history');
    if (token !== historyRead) return;
    receiveHistory(response);
  }
  function receiveHistory(response: Awaited<ReturnType<WorkspaceBindings['client']['get']>>): void {
    if (!response.ok) return clearHistory();
    receiveHistoryOutcome(wireOutcome('service', response.value.outcome));
  }
  function receiveHistoryOutcome(outcome: Result<unknown>): void {
    if (!outcome.ok) return clearHistory();
    const checked = historyStatusSchema.safeParse(outcome.value);
    if (!checked.success) return clearHistory();
    update({ history: historyView(historyGate, checked.data) });
    releaseHistory();
  }
  function clearHistory(): void {
    update({ history: historyView(historyGate, null) });
  }
  /** Undo/redo or a request in the journal holds edits back. */
  function historyBlocked(): boolean {
    return editsHeld(historyGate, state.pending);
  }
  /** Moves the gate, then publishes its hold and the mutation flag. */
  function setHistoryGate(next: HistorySlot): void {
    historyGate = next;
    update({ history: historyView(next, state.history?.status ?? null) });
    updateMutationAvailability();
  }
  /** Claim synchronously before any await, then retain the exact selected request through submission recovery. */
  async function navigateHistory(direction: 'undo' | 'redo'): Promise<void> {
    const status = navigableStatus(historyGate, state, canvasDraft());
    if (status === null) return;
    setHistoryGate(heldHistory(historyGate));
    await submitHistory(status, direction);
  }
  /** A canvas gesture is still unfinished. */
  function canvasDraft(): boolean {
    return Boolean(state.active?.session.getSnapshot().draft);
  }
  async function submitHistory(
    status: NonNullable<WorkspaceView['history']>['status'],
    direction: 'undo' | 'redo',
  ): Promise<void> {
    try {
      await sendHistory(status, direction);
    } finally {
      releaseNavigationAttempt();
    }
  }
  /** The attempt's hold ends unless an inverse is settling; that one releases in releaseHistory. */
  function releaseNavigationAttempt(): void {
    if (!inverseSettling(historyGate)) setHistoryGate(historyIdle);
  }
  async function sendHistory(
    status: unknown,
    direction: 'undo' | 'redo',
  ): Promise<void> {
    const request = bindings.inputs.history(status, direction, bindings.nextId());
    if (!request.ok) return report(request.error);
    if (request.value !== null) await applyHistoryRequest(request.value);
  }
  async function applyHistoryRequest(request: Request): Promise<void> {
    const result = await submitCurrent(request);
    if (!result.ok) await finishHistory();
  }
  async function reconcileHistory(): Promise<void> {
    for (const item of unresolvedInverses(state.pending))
      await reconcileRequest(item.request.request);
  }
  /** A receipt does not release editing until the canonical scene and targets have caught up. */
  async function finishHistory(
    sequence = state.snapshot?.sequence ?? 0,
    carriedSnapshot?: CarriedSnapshot,
  ): Promise<void> {
    historyRead += 1;
    // Cleared with the hold the gate had; the settling gate then holds and publishes again.
    clearHistory();
    // The gate settles before the snapshot installs, so the install is the snapshot it sees.
    setHistoryGate(settlingHistory(sequence));
    await catchUp(carriedSnapshot);
    await refreshHistory();
    releaseHistory();
  }
  /** The settling gate releases once the scene and history have caught up and no render is in flight. */
  function releaseHistory(): void {
    if (historyReady(historyGate, state, rendering === null)) setHistoryGate(historyIdle);
  }
  function chooseMoveOption(optionId: string): void {
    const held = awaitingChoice(movementSlot);
    if (held !== null) showMoveOption(held, optionId);
  }
  /** The scene previews an offered option before the review shows it. */
  function showMoveOption(
    held: MovementHeld,
    optionId: string,
  ): void {
    const option = offeredOption(held, optionId);
    if (option === null || !acceptMovementOptionPreview(held, option)) return;
    showMovement(withOption(held, optionId));
  }
  function acceptMovementOptionPreview(
    held: MovementHeld,
    option: MoveOption,
  ): boolean {
    const { active, intent } = held.capture;
    const accepted = active.session.dispatch({
      kind: 'preview-routes',
      id: intent.id,
      ...option.preview,
    });
    if (accepted.ok && accepted.value.state.routePreview?.gesture === intent.id) return true;
    report(optionPreviewRefused());
    return false;
  }

  async function applyMove(optionId: string): Promise<void> {
    const prepared = prepareMovementApplication(optionId);
    if (prepared === null) return;
    const { held, option } = prepared;
    showMovement(sendingMove(held, optionId), { status: 'Saving…' });
    updateMutationAvailability();
    await submitFeasibleCanvas(
      held.capture.active,
      held.capture.intent,
      option.changes,
      option.preview,
    );
  }
  /** The review and its option when the shown option may be sent now; each refusal is reported. */
  function prepareMovementApplication(optionId: string): {
    held: MovementHeld;
    option: MoveOption;
  } | null {
    const held = applicable(movementSlot, optionId);
    if (held === null || reportMovementSubmissionBlocked()) return null;
    return currentMovementApplication(held, optionId);
  }
  /** The chosen option while it is current and the scene still shows its preview. */
  function currentMovementApplication(
    held: MovementHeld,
    optionId: string,
  ): { held: MovementHeld; option: MoveOption } | null {
    const option = selectedMovementOption(held, optionId);
    if (option === null || !hasCurrentMovementPreview(held)) return null;
    return { held, option };
  }
  /** A request or undo/redo holds the move back; the draft stays. */
  function reportMovementSubmissionBlocked(): boolean {
    if (!moveSubmissionBlocked(state, historyGate)) return false;
    report(operationBusy());
    return true;
  }
  /** The chosen option while the review still matches the diagram, workspace and scene. */
  function selectedMovementOption(
    held: MovementHeld,
    optionId: string,
  ): MoveOption | null {
    const { active, review } = held.capture;
    const stamp = active.session.getSnapshot().stamp;
    const chosen =
      bindings.chooseMoveOption?.(review, optionId, stamp) ??
      chooseReviewedMoveOption(review, optionId, stamp);
    const current = currentChoice(held.capture, chosen, state, stamp);
    if (current.ok) return current.value;
    report(current.error);
    return null;
  }
  function hasCurrentMovementPreview(held: MovementHeld): boolean {
    const { active, intent } = held.capture;
    if (active.session.getSnapshot().routePreview?.gesture === intent.id) return true;
    report(previewGone());
    return false;
  }
  /** Only a review awaiting a choice may be cancelled; one being sent waits for its receipt. */
  function cancelMove(): void {
    const held = awaitingChoice(movementSlot);
    if (held === null) return report(alreadySaving());
    held.capture.active.session.dispatch({ kind: 'discard', id: held.capture.intent.id });
    showMovement(null, { status: 'Movement cancelled', problem: null });
    updateMutationAvailability();
  }
  async function exportArtifact(input: unknown): Promise<Result<BinaryResponse>> {
    if (bindings.client.bytes === undefined)
      return {
        ok: false,
        error: diagnostic(
          'export-unavailable',
          'Export is unavailable in this service session.',
          'Reconnect to the workspace and try again.',
        ),
      };
    return bindings.client.bytes('/api/v1/export', input);
  }
  return {
    navigateHistory,
    inspector,
    definitions,
    wires,
    library,
    showLibrary,
    beginCollectionSwitch,
    cancelCollectionSwitch,
    chooseCollection,
    retryCollectionSwitch,
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    open,
    refresh,
    showSource: source.show,
    editSource: source.edit,
    applySource: source.apply,
    closeSource: source.close,
    reconcileRequest,
    dismissRequest,
    // Clearing the problem also dismisses the refused request (see update).
    dismissProblem: () => update({ problem: null, status: editStatus() }),
    retryRequest,
    create,
    addDiagram,
    addObject,
    addGroup,
    setDiagramDraft,
    setObjectDraft,
    setGroupDraft,
    cancelCreation,
    editConnection,
    applyConnection,
    cancelConnection,
    exportArtifact,
    report,
    reportCanvas: (error) => report(canvasFailure(error)),
    applyMove,
    chooseMoveOption,
    cancelMove,
    dispose: () => {
      disposed = true;
      removeHistoryKeys();
      unsubscribe();
      stopEditorStatus.forEach((stop) => stop());
      invalidateRender();
      snapshotRead += 1;
      state.active?.session.dispose();
      listeners.clear();
    },
  };
}
