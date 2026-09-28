/*
 * The undo/redo gate. An undo or redo holds it from the moment it is claimed, and an inverse
 * request that leaves the journal unrefused holds it too. Once the inverse settles, the gate waits
 * for a snapshot at or past the settled sequence, a history version that matches the snapshot, the
 * displayed collection at its listed revision and no render in flight; only then does it release.
 * What the gate refuses meanwhile is in journal.ts. Pure; the session sends requests and publishes.
 */
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import { diagramCurrent } from '../render/navigation.js';

/** The gate: idle; held by an attempt or a finished inverse; settling towards a snapshot sequence. */
export type HistorySlot =
  | { readonly phase: 'idle' }
  | { readonly phase: 'held' }
  | {
      readonly phase: 'settling';
      readonly sequence: number;
      /** A snapshot at or past `sequence` has arrived. */
      readonly snapshotSeen: boolean;
    };

/** The history part of the view: the navigable status and whether the gate is held. */
export type HistoryView = NonNullable<WorkspaceView['history']>;

/** The status undo and redo navigate from. */
export type HistoryStatus = NonNullable<HistoryView['status']>;

/** The parts of the workspace view the gate reads. */
export type GateView = Pick<
  WorkspaceView,
  'history' | 'snapshot' | 'active' | 'collections' | 'pending'
>;

/** No undo or redo in progress. */
export const historyIdle: HistorySlot = { phase: 'idle' };

/** The gate claimed; a settling inverse stays settling. */
export function heldHistory(slot: HistorySlot): HistorySlot {
  if (slot.phase !== 'idle') return slot;
  return { phase: 'held' };
}

/** A settled inverse waits for the snapshot at `sequence`. */
export function settlingHistory(sequence: number): HistorySlot {
  return { phase: 'settling', sequence, snapshotSeen: false };
}

/** Whether a settled inverse still waits to catch up. */
export function inverseSettling(slot: HistorySlot): boolean {
  return slot.phase === 'settling';
}

/** Whether the gate holds edits: claimed, or an inverse settling. */
export function gateHeld(slot: HistorySlot): boolean {
  return slot.phase !== 'idle';
}

/** The gate once a snapshot at `sequence` arrives. */
export function observeSnapshot(
  slot: HistorySlot,
  sequence: number,
): HistorySlot {
  if (slot.phase !== 'settling' || sequence < slot.sequence) return slot;
  return { ...slot, snapshotSeen: true };
}

/** Whether a settling gate may release: see the header. */
export function historyReady(
  slot: HistorySlot,
  view: GateView,
  renderIdle: boolean,
): boolean {
  if (slot.phase !== 'settling') return false;
  return renderIdle && slot.snapshotSeen && caughtUp(view);
}

/** The history view with the gate's hold. */
export function historyView(
  slot: HistorySlot,
  status: HistoryStatus | null,
): HistoryView {
  return { status, busy: gateHeld(slot) };
}

/** The history version matches the snapshot and the displayed collection is current. */
function caughtUp(view: GateView): boolean {
  return matchingVersion(view) && displayedCurrent(view);
}

/** The snapshot holds the record the history status navigates by, at the same version. */
function matchingVersion(view: GateView): boolean {
  const token = view.history?.status?.navigationVersion;
  if (!token) return false;
  const record = view.snapshot?.records.find(
    (item) => item.key.kind === token.key.kind && item.key.id === token.key.id,
  );
  return record?.version === token.version;
}

/** The library, or a diagram at its listed revision. */
function displayedCurrent(view: GateView): boolean {
  return view.active === null || diagramCurrent(view.collections, view.active);
}
