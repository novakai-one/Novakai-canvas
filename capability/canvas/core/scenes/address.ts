import type { Target } from '../../contract/records/selection.js';
import type { SceneIndex, TargetInfo } from '../../contract/records/scene.js';
import { reject } from '../validation/outcomes.js';
/** URI-encoded JSON tuples preserve namespaces and remain safe in React Flow CSS selectors; callers never parse the key. */
export function targetKey(target: Target): string {
  const address =
    target.kind === 'section' ? ['section', target.id] : [target.kind, target.section, target.id];
  return encodeURIComponent(JSON.stringify(address));
}
/** Section lookup is explicit for all target variants; no encoded scene ID conventions leak. */
export function sectionId(target: Target): string {
  if (target.kind === 'section') return target.id;
  return target.section;
}
/** Resolve a checked interaction target; public transition failure leaves current selection intact. */
export function targetInfo(
  index: SceneIndex,
  target: Target,
): TargetInfo {
  const found = index.targets[targetKey(target)];
  if (!found)
    return reject('unknown-target', targetKey(target), 'The target is not in the displayed scene');
  return found;
}
