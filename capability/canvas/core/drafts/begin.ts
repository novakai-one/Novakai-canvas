import { treeNode } from '../scenes/tree.js';
import { ancestorKeys } from '../scenes/ancestry.js';
import type { SessionState } from '../../contract/records/state.js';
import type { Target } from '../../contract/records/selection.js';
import type { GeometryEntry, GestureDraft, RouteDraft } from '../../contract/records/draft.js';
import type { EventOf } from '../../contract/events.js';
import { targetKey, targetInfo } from '../scenes/address.js';
import { reject } from '../validation/outcomes.js';
import { canMutate } from '../interaction/changes.js';
/** Parent selection subsumes its descendants, so a group drag never applies the delta twice. */
function hasSelectedAncestor(
  state: SessionState,
  target: Target,
  selected: ReadonlySet<string>,
): boolean {
  return ancestorKeys(state.index, targetKey(target)).some((key) => selected.has(key));
}
/** Capture immutable world geometry for the selected top-level movers. */
function originalGeometry(
  state: SessionState,
  targets: readonly Target[],
): readonly GeometryEntry[] {
  const selected = new Set(targets.map(targetKey));
  return targets
    .filter((target) => !hasSelectedAncestor(state, target, selected))
    .map((target) => geometryEntry(state, target));
}
/** Only nodes and sections support placement; wire/sequence mutation uses its own semantic control. */
function geometryEntry(
  state: SessionState,
  target: Target,
): GeometryEntry {
  if (target.kind === 'wire' || target.kind === 'sequence')
    reject('invalid-gesture', targetKey(target), 'This target cannot be moved as a node');
  if (treeNode(state, target))
    reject('invalid-gesture', targetKey(target), 'Move the whole tree section instead');
  const info = targetInfo(state.index, target);
  return { target, box: info.box, locked: info.locked };
}
/** Route starts retain the displayed endpoints and path; caller cannot introduce a foreign wire. */
function routeDraft(
  state: SessionState,
  event: EventOf<'begin'>,
): RouteDraft {
  const target = event.targets[0];
  if (target?.kind !== 'wire')
    return reject('invalid-gesture', event.id, 'Route requires one wire target');
  const wire = state.index.wires[targetKey(target)];
  if (!wire) return reject('unknown-target', target.id, 'Wire no longer exists');
  const original = {
    points: wire.points,
    sourceSide: 'preserve' as const,
    targetSide: 'preserve' as const,
    locked: 'preserve' as const,
  };
  return {
    kind: 'route',
    id: event.id,
    generation: 0,
    base: state.stamp,
    target,
    original,
    current: original,
    changed: false,
  };
}
/** Draft identifiers cannot collide with pending/recoverable work; host allocates a fresh gesture ID. */
function validateStart(
  state: SessionState,
  event: EventOf<'begin'>,
): void {
  if (state.draft !== null)
    reject('invalid-gesture', event.id, 'Finish or cancel the current gesture');
  validateAvailable(state, event);
  if (state.recovery.some((entry) => entry.draft.id === event.id))
    reject('invalid-gesture', event.id, 'Gesture identity is already retained');
  validateTargets(event);
  validateRecoveryCapacity(state);
}
/** Resize/route operate on one target; move supports a bounded multi-selection. */
function validateTargets(event: EventOf<'begin'>): void {
  if (event.targets.length === 0) reject('invalid-gesture', event.id, 'Choose at least one target');
  requireSingleTarget(event);
}
/** Move alone permits multiple independent top-level targets. */
function requireSingleTarget(event: EventOf<'begin'>): void {
  if (event.gesture === 'move') return;
  if (event.targets.length !== 1)
    reject('invalid-gesture', event.id, 'This gesture requires one target');
}
/** Build one recoverable gesture; public transition returns a typed failure without changing state. */
export function beginDraft(
  state: SessionState,
  event: EventOf<'begin'>,
): GestureDraft {
  validateStart(state, event);
  if (event.gesture === 'route') return routeDraft(state, event);
  const original = originalGeometry(state, event.targets);
  return {
    kind: event.gesture,
    id: event.id,
    generation: 0,
    base: state.stamp,
    original,
    current: original,
    changed: false,
  };
}

/** Fixed read-only and current service gates both protect draft creation. */
function validateAvailable(
  state: SessionState,
  event: EventOf<'begin'>,
): void {
  if (!canMutate(state))
    reject('mutation-unavailable', event.id, 'Editing is currently unavailable');
}

/** Bounded retained gestures prevent unlimited memory growth; host persists/discards recovery before starting more. */
function validateRecoveryCapacity(state: SessionState): void {
  if (state.recovery.length >= 1000)
    reject(
      'invalid-gesture',
      'recovery',
      'Resolve retained drafts before starting another gesture',
    );
}
