import type { VisualSection, VisualSequenceItem } from '../../contract/records/input.js';
import type { FragmentFrame } from '../../contract/records/geometry.js';
import { reject } from '../validation/outcomes.js';
export interface ScopeStep {
  readonly fragment: string;
  readonly branch: string | null;
}
export type ScopePath = readonly ScopeStep[];
export interface VerticalRange {
  readonly top: number;
  readonly bottom: number;
}
/** Every enclosing fragment contributes a scope; alt alternatives remain explicitly distinguishable. */
export function eventScope(
  id: string,
  section: VisualSection,
): ScopePath {
  const input = section.sequence.find((item) => item.item.id === id);
  if (!input) return reject('invalid-input', id, 'Sequence event has no source scope');
  return parentScope(input.item, section);
}
/** Canonical acyclic parent references bound this walk; plain event order never implies shared execution. */
function parentScope(
  item: VisualSequenceItem['item'],
  section: VisualSection,
): ScopePath {
  if (item.parent === undefined) return [];
  return [
    ...eventScope(item.parent, section),
    { fragment: item.parent, branch: item.branch ?? null },
  ];
}
/** A parent execution path includes all of its descendant fragment paths. */
export function covers(
  parent: ScopePath,
  child: ScopePath,
): boolean {
  return (
    parent.length <= child.length && parent.every((step, index) => sameStep(step, child[index]))
  );
}
/** Scope identity compares canonical fragment and branch names, never a parsed string convention. */
function sameStep(
  a: ScopeStep,
  b: ScopeStep | undefined,
): boolean {
  return a.fragment === b?.fragment && a.branch === b?.branch;
}
/** A shared ancestor and its descendant can co-occur; different alternatives cannot. */
export function compatible(
  a: ScopePath,
  b: ScopePath,
): boolean {
  return covers(a, b) || covers(b, a);
}
/** Resolve the measured vertical range of the innermost scope. Root scope uses its caller's interval. */
export function scopeRange(
  path: ScopePath,
  frames: readonly FragmentFrame[],
  fallback: VerticalRange,
): VerticalRange {
  const step = path.at(-1);
  if (!step) return fallback;
  const frame = frames.find((item) => item.id === step.fragment);
  if (!frame) return reject('invalid-input', step.fragment, 'Activation scope frame is missing');
  return frameRange(step, frame);
}
/** Unbranched fragments use their frame; an alt branch uses its independently measured band. */
function frameRange(
  step: ScopeStep,
  frame: FragmentFrame,
): VerticalRange {
  if (step.branch === null) return { top: frame.box.y, bottom: frame.box.y + frame.box.height };
  const branch = frame.branches.find((item) => item.id === step.branch);
  if (!branch)
    return reject('invalid-input', step.branch, 'Activation alternative frame is missing');
  return { top: branch.box.y, bottom: branch.box.y + branch.box.height };
}
/** Closure in every alternative closes the parent; optional/loop bodies alone never prove unconditional closure. */
export function fullyClosed(
  path: ScopePath,
  closed: readonly ScopePath[],
  section: VisualSection,
): boolean {
  if (closed.some((scope) => covers(scope, path))) return true;
  const fragments = new Set(
    closed
      .filter((scope) => covers(path, scope))
      .flatMap((scope) => nextFragment(scope, path.length)),
  );
  return [...fragments].some((fragment) => allAlternatives(fragment, path, closed, section));
}
/** Only a deeper scope can contribute another fragment to the closure proof. */
function nextFragment(
  path: ScopePath,
  depth: number,
): readonly string[] {
  const step = path[depth];
  if (!step) return [];
  return [step.fragment];
}
/** Alternative names are read from the canonical fragment, including alternatives with no events. */
function allAlternatives(
  id: string,
  path: ScopePath,
  closed: readonly ScopePath[],
  section: VisualSection,
): boolean {
  const source = section.sequence.find((item) => item.item.id === id)?.item;
  if (source?.kind !== 'fragment') return false;
  if (source.operator !== 'alt') return false;
  return source.branches.every((branch) =>
    fullyClosed([...path, { fragment: id, branch: branch.id }], closed, section),
  );
}
/** Remove previously closed branch bands from a continuing activation's remaining visible intervals. */
export function subtractRanges(
  range: VerticalRange,
  excluded: readonly VerticalRange[],
): readonly VerticalRange[] {
  return excluded.reduce<readonly VerticalRange[]>(
    (ranges, exclusion) => ranges.flatMap((range) => subtract(range, exclusion)),
    [range],
  );
}
/** Disjoint ranges remain unchanged; a covered interval can leave a prefix, suffix or nothing. */
function subtract(
  range: VerticalRange,
  excluded: VerticalRange,
): readonly VerticalRange[] {
  if (excluded.bottom <= range.top || excluded.top >= range.bottom) return [range];
  const parts = [
    { top: range.top, bottom: Math.min(range.bottom, excluded.top) },
    { top: Math.max(range.top, excluded.bottom), bottom: range.bottom },
  ];
  return parts.filter((part) => part.bottom > part.top);
}
