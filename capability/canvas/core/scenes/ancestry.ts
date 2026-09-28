import type { SceneIndex } from '../../contract/records/scene.js';
/** Bounded admitted parent chains are read iteratively; returned path excludes the target itself. */
export function ancestorKeys(
  index: SceneIndex,
  key: string,
): readonly string[] {
  const result: string[] = [];
  let parent = index.targets[key]?.parentKey ?? null;
  while (parent !== null) {
    result.push(parent);
    parent = index.targets[parent]?.parentKey ?? null;
  }
  return result;
}
