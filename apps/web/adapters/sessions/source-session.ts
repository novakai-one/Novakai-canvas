import type {
  CapturedSourceBase,
  SourceBindings,
  SourceController,
  SourceView,
} from '../../contract/records/source.js';
import type {
  Receipt,
  Snapshot,
  Request,
  ReadVersion,
  StoredRecord,
} from '../../contract/records/owners.js';
import type { Submission } from '../../contract/records/submission.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type { TransportGeneration, WorkspaceId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import {
  encodeSourceRecovery,
  inWorkspace,
  isCollectionKey,
  restoredWorkspace,
  unrestoredWorkspace,
} from '../../contract/api.js';
import { failure } from '../../contract/errors.js';
/** Source editor owns its draft, captured base and recovery record. It cannot commit without the injected submission owner. */
export function createSourceController(bindings: SourceBindings): SourceController {
  let state: SourceView = {
    sourceCloseRequested: false,
    sourceOpen: false,
    source: '',
    sourceDirty: false,
    sourceBase: { kind: 'none' },
    sourceEdit: 0,
  };
  let sourceReceipt: Receipt | null = null;
  let admitted: WorkspaceScope = unrestoredWorkspace;
  /** Every update publishes an immutable editor snapshot; other workspace state has a different owner. */
  function update(patch: Partial<SourceView>): void {
    state = { ...state, ...patch };
    bindings.changed(state);
  }
  /** Preserve drafts on owner/provider failure and let the shell display the correction action. */
  const report = bindings.report;
  /** Receipt acknowledgement applies only to this source editor's submitted collection and generation. */
  function confirmed(
    submission: Submission,
    receipt: Receipt,
  ): void {
    if (!isSourceSubmission(submission.request)) return;
    sourceReceipt = receipt;
    update({ sourceDirty: remainingSourceDraft(submission.request, submission.sourceEdit) });
    retainSource();
  }
  /** Newer typing can advance its base only across its own confirmed commit, never across a foreign edit. */
  function rebaseConfirmedSource(
    snapshot: Snapshot,
    generation: TransportGeneration,
  ): void {
    const receipt = sourceReceipt;
    const captured = state.sourceBase;
    if (receipt === null || captured.kind === 'none') return;
    const version = receipt.versions.find((item) => isCollectionKey(item.key, captured.collection));
    const record = snapshot.records.find((item) => isCollectionKey(item.key, captured.collection));
    if (!matchingVersion(version, record)) return;
    update({ sourceBase: { ...captured, base: snapshot, generation } });
    sourceReceipt = null;
    retainSource();
  }
  /** Geometry and creation receipts cannot clear an unrelated source draft. */
  function remainingSourceDraft(
    request: Request,
    sourceEdit: number,
  ): boolean {
    if (!isSourceSubmission(request)) return state.sourceDirty;
    return state.sourceDirty && state.sourceEdit !== sourceEdit;
  }
  /** Source confirmation applies only to the collection whose editor owns the captured draft. */
  function isSourceSubmission(request: Request): boolean {
    const captured = state.sourceBase;
    if (request.intent.kind !== 'change' || captured.kind === 'none') return false;
    return (
      request.intent.planner === bindings.dslPlanner &&
      request.scope.some((key) => isCollectionKey(key, captured.collection))
    );
  }
  /** Opening source uses the exact admitted collection, retaining that snapshot as the editing base. */
  async function showSource(open: boolean): Promise<void> {
    if (!open) {
      requestSourceClosure();
      return;
    }
    update({ sourceOpen: true });
    loadCleanSource();
  }
  /** Dirty content requires a choice; a clean editor can close immediately. */
  function requestSourceClosure(): void {
    if (state.sourceDirty) {
      update({ sourceCloseRequested: true });
      return;
    }
    update({ sourceOpen: false });
  }
  /** A retained dirty editor always wins over remote readout. */
  function loadCleanSource(): void {
    if (state.sourceDirty) return;
    loadSource();
  }
  /** Readable DSL prints through Language; it is not reconstructed from visual node coordinates. */
  function loadSource(): void {
    const active = bindings.current();
    if (active === null) return;
    const collection = active.document.collection;
    const printed = bindings.inputs.source(collection);
    if (!printed.ok) {
      report(printed.error);
      return;
    }
    update({
      source: printed.value,
      sourceBase: {
        kind: 'captured',
        base: active.base,
        generation: active.generation,
        collection: collection.id,
      },
    });
  }
  /** Form typing remains local and durable; it never triggers an implicit Authoring apply. */
  function editSource(source: string): void {
    update({ source, sourceDirty: true, sourceEdit: state.sourceEdit + 1 });
    retainSource();
  }
  /** One checked recovery record includes the exact source base and edit generation. */
  function retainSource(): void {
    const captured = state.sourceBase;
    if (captured.kind === 'none') return;
    const saved = persistSource(captured);
    if (!saved.ok) report(saved.error);
  }
  /**
   * Clean source has no recoverable draft; dirty source persists its exact authoring base. A base
   * outside the admitted workspace is `recovery-unavailable`.
   */
  function persistSource(captured: CapturedSourceBase): Result<void> {
    const workspace = captured.base.workspace;
    if (!inWorkspace(admitted, workspace))
      return failure(
        'recovery-unavailable',
        'Source recovery has not admitted this workspace; stored data was retained',
      );
    return persistAdmittedSource(`source-draft.${workspace}`, captured);
  }
  function persistAdmittedSource(
    key: string,
    captured: CapturedSourceBase,
  ): Result<void> {
    if (!state.sourceDirty) return bindings.retention.remove(key);
    const encoded = encodeSourceRecovery({
      source: state.source,
      base: captured.base,
      generation: captured.generation,
      collection: captured.collection,
      edit: state.sourceEdit,
    });
    if (!encoded.ok) return encoded;
    return bindings.retention.write(key, encoded.value);
  }
  /** Closing a dirty editor is an explicit human choice; keeping it never discards its source/base. */
  function closeSource(decision: 'keep' | 'discard' | 'stay'): void {
    if (decision === 'stay') {
      update({ sourceCloseRequested: false });
      return;
    }
    if (decision === 'discard') {
      update({ sourceDirty: false });
      retainSource();
    }
    update({ sourceOpen: false, sourceCloseRequested: false });
  }
  /** Browser recovery never rewrites a draft's captured revision to the latest remote version. */
  function restoreSource(workspace: WorkspaceId): void {
    admitted = unrestoredWorkspace;
    const stored = bindings.retention.read(`source-draft.${workspace}`);
    if (!stored.ok) {
      report(stored.error);
      return;
    }
    if (stored.value === null) {
      admitted = restoredWorkspace(workspace);
      return;
    }
    restoreCheckedSource(stored.value, workspace);
  }
  /** Reject cross-workspace recovery records even when their source and snapshot are individually valid. */
  function restoreCheckedSource(
    input: unknown,
    workspace: WorkspaceId,
  ): void {
    const checked = bindings.inputs.sourceRecovery(input);
    if (!checked.ok) {
      report(checked.error);
      return;
    }
    if (checked.value.base.workspace !== workspace) {
      report(
        failure('wrong-workspace', 'The retained source belongs to a different workspace').error,
      );
      return;
    }
    const value = checked.value;
    admitted = restoredWorkspace(workspace);
    update({
      source: value.source,
      sourceBase: {
        kind: 'captured',
        base: value.base,
        generation: value.generation,
        collection: value.collection,
      },
      sourceEdit: value.edit,
      sourceDirty: true,
      sourceOpen: true,
    });
  }
  function admittedSourceBase(): CapturedSourceBase | null {
    const captured = state.sourceBase;
    if (captured.kind === 'none') return null;
    if (inWorkspace(admitted, captured.base.workspace)) return captured;
    report(
      failure(
        'recovery-unavailable',
        'Source recovery has not admitted this workspace; apply was refused',
      ).error,
    );
    return null;
  }
  /** Apply uses captured source preconditions even if an agent has since committed a newer collection. */
  async function applySource(): Promise<void> {
    const captured = admittedSourceBase();
    if (captured === null) return;
    const request = bindings.replaceRequest(captured, state.source);
    if (!request.ok) {
      report(request.error);
      return;
    }
    await bindings.submit(request.value, captured.generation, state.sourceEdit, null);
  }

  return {
    getSnapshot: () => state,
    refreshReadout: loadCleanSource,
    show: showSource,
    edit: editSource,
    apply: applySource,
    close: closeSource,
    restore: restoreSource,
    confirmed,
    reconcile: rebaseConfirmedSource,
  };
}
/** A receipt must name an actual collection version; two missing lookups cannot authorize rebasing a draft. */
function matchingVersion(
  version: ReadVersion | undefined,
  record: StoredRecord | undefined,
): boolean {
  if (version === undefined) return false;
  return version.version === record?.version;
}
