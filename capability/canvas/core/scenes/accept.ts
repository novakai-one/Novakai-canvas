import type { SceneAdmission } from '../../contract/ports/scene-admission.js';
import type { Scene, SceneStamp } from '../../contract/records/scene.js';
import type { SessionState } from '../../contract/records/state.js';
import type { OpenInput } from '../../contract/schemas.js';
import { accepted, reject } from '../validation/outcomes.js';
import { validateScene } from './validate.js';
import { indexScene } from './index.js';
import { fitBounds } from '../camera/navigate.js';
/** Stamp equality distinguishes displayed data from a separately requested asynchronous result. */
export function sameStamp(
  left: SceneStamp,
  right: SceneStamp,
): boolean {
  return [
    left.collectionId === right.collectionId,
    left.revision === right.revision,
    left.inputKey === right.inputKey,
    left.generation === right.generation,
  ].every(Boolean);
}
/** Freeze a detached admitted data tree once; pointer moves never traverse or freeze the scene again. */
function freezeTree(value: unknown): void {
  if (value === null) return;
  if (typeof value !== 'object') return;
  Object.values(value).forEach(freezeTree);
  Object.freeze(value);
}
/** Required owner admission returns validated content; Canvas checks its stamp and owned geometry before detaching it. */
export function admitScene(
  reader: SceneAdmission,
  payload: unknown,
  expected: SceneStamp,
): Scene {
  const scene = accepted(reader.read(payload, expected));
  const actual = {
    collectionId: scene.collectionId,
    revision: scene.revision,
    inputKey: scene.inputKey,
    generation: expected.generation,
  };
  if (!sameStamp(actual, expected))
    reject('stale-scene', 'scene', 'Admitted scene does not match requested stamp');
  validateScene(scene);
  const detached = structuredClone(scene);
  freezeTree(detached);
  return detached;
}
/** Initial fit happens exactly here; accepted updates never reuse this opening path. */
export function openSession(
  reader: SceneAdmission,
  input: OpenInput,
): SessionState {
  const scene = admitScene(reader, input.scene, input.expected);
  validateProfile(input);
  const initial = { x: 0, y: 0, zoom: 1, viewport: input.viewport };
  const camera =
    input.camera === null
      ? fitBounds(initial, scene.bounds, input.profile)
      : { ...input.camera, viewport: input.viewport };
  return Object.freeze({
    scene,
    index: indexScene(scene),
    stamp: input.expected,
    requested: input.expected,
    readOnly: input.readOnly,
    camera,
    profile: input.profile,
    selection: [],
    hover: null,
    tool: 'select',
    connection: null,
    draft: null,
    recovery: [],
    reading: null,
    connected: true,
    mutationAvailable: true,
  });
}
/** A job request may supersede an older request while the currently displayed scene remains untouched. */
export function expectScene(
  state: SessionState,
  stamp: SceneStamp,
): SessionState {
  if (sameStamp(state.requested, stamp)) return state;
  validateRequested(state, stamp);
  return { ...state, requested: stamp };
}
/** Collection switching requires open; regressive jobs cannot reopen an old revision or generation. */
function validateRequested(
  state: SessionState,
  stamp: SceneStamp,
): void {
  validateCollection(state, stamp);
  if (stamp.revision < state.stamp.revision)
    reject('stale-scene', 'revision', 'Requested revision is older than displayed scene');
  if (stamp.generation <= state.requested.generation)
    reject('stale-scene', 'generation', 'Requested generation must advance');
}

/** Coarse interaction controls cannot be less forgiving than their fine-pointer equivalents. */
function validateProfile(input: OpenInput): void {
  if (input.profile.coarseThreshold < input.profile.fineThreshold)
    reject('invalid-input', 'profile', 'Coarse drag threshold must be at least fine threshold');
  if (input.profile.coarseNudge < input.profile.nudge)
    reject('invalid-input', 'profile', 'Coarse nudge must be at least normal nudge');
}

/** A Canvas session never switches collection implicitly through an asynchronous result. */
function validateCollection(
  state: SessionState,
  stamp: SceneStamp,
): void {
  if (stamp.collectionId !== state.stamp.collectionId)
    reject('stale-scene', 'collectionId', 'Open a new session to switch collections');
}
