/* Scene geometry aliases and parent navigation shared by the capture and rearrange modules. */
import type { RenderDocument } from '../../../contract/records/owners.js';

/** One section of the rendered scene. */
export type SceneSection = RenderDocument['scene']['sections'][number];

/** One node of a rendered scene section. */
export type SceneNode = SceneSection['nodes'][number];

/** The node's parent in the scene, when it has one. */
export function parentNode(
  scene: SceneSection,
  node: SceneNode,
): SceneNode | undefined {
  return node.parent === null ? undefined : scene.nodes.find((item) => item.id === node.parent);
}
