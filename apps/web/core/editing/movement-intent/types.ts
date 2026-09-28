/*
 * The vocabulary the movement-intent checks share: one placement entry and a node found in the
 * scene with its section. Pure types; the rules live in admission, selection and expected.
 */
import type { PlacementIntent } from '../../../contract/records/owners.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';

/** One entry of a placement intent: a target and its requested local placement. */
export type PlacementEntry = PlacementIntent['entries'][number];

/** A node target found in the scene, with the section that holds it. */
export type CapturedNode = { readonly section: SceneSection; readonly node: SceneNode };
