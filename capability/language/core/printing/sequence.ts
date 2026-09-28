import type { Section } from '../../contract/ports/model.js';
import { header } from './properties.js';
import { body } from './strings.js';
import { requireDepth } from './layout.js';
type Item = Section['sequence'][number];
type Fragment = Extract<Item, { kind: 'fragment' }>;
/** Sequence numbers are rank keys; print their induced sibling order inside each parent/branch scope. */
export function printSequence(
  section: Section,
  parent?: string,
  branch?: string,
  depth = 0,
): readonly string[] {
  requireDepth(depth);
  return section.sequence
    .filter((item) => item.parent === parent && item.branch === branch)
    .toSorted((a, b) => a.order - b.order)
    .map((item) => printItem(section, item, depth));
}
/** Message kind remains an attribute while event is the source construct. */
function printItem(
  section: Section,
  item: Item,
  depth: number,
): string {
  if (item.kind === 'event') return header('event', item);
  return body(header('fragment', item), fragmentBody(section, item, depth + 1));
}
/** Alternative branch order and explicit identities remain exact across every read and replacement. */
function fragmentBody(
  section: Section,
  fragment: Fragment,
  depth: number,
): readonly string[] {
  if (fragment.operator !== 'alt') return printSequence(section, fragment.id, undefined, depth);
  return fragment.branches.map((branch) =>
    body(header('branch', branch), printSequence(section, fragment.id, branch.id, depth)),
  );
}
