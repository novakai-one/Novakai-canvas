/*
 * Lowering a sequence section's `event` and `fragment` statements to one flat, ordered list of
 * items. Nesting becomes `parent` and `branch` fields; order is kept per parent and branch. No
 * side effects. Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Declaration } from '../../contract/records/syntax.js';
import { id, text, optional, type RawRecord } from './fields.js';
import { lowerRecord } from './content.js';
import { reject } from '../validation/outcomes.js';

/** Where a nested item sits: its fragment and, inside an `alt`, its branch. */
interface SequenceScope {
  /** The ID of the fragment that contains the item. */
  readonly parent?: string;

  /** The ID of the `alt` branch that contains the item. */
  readonly branch?: string;
}

/**
 * Flattens the events and fragments among `children` (other statements are skipped). Each item
 * gets its `order` among the kept siblings and the scope's `parent`/`branch`, and a fragment is
 * followed by its own flattened contents. An `alt` fragment lists its `branches`; a branch
 * without an `@id` gets the ID `<fragment>-branch-<n>`, where `n` is its position among all of
 * the `alt`'s branches, counting from 1. Any other fragment has no branches.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic for a branch outside an `alt`, or a
 * statement other than `branch` directly inside an `alt`; and every fault from lowering an item.
 */
export function lowerSequence(
  children: readonly Declaration[],
  scope: SequenceScope = {},
): readonly RawRecord[] {
  const items = children.filter(isSequence);
  return items.flatMap((item, order) => lowerItem(item, order, scope));
}

/** Whether a statement is in the message order: an event or a fragment (not a `show`). */
function isSequence(item: Declaration): boolean {
  return item.kind === 'event' || item.kind === 'fragment';
}

/**
 * One item: its record, then the scope, its `order`, and `kind` (`event` or `fragment`). `kind`
 * is the construct; an event's written `kind=` is kept as `message`. A fragment is followed by
 * its contents.
 */
function lowerItem(
  item: Declaration,
  order: number,
  scope: SequenceScope,
): readonly RawRecord[] {
  const base = { ...lowerRecord(item), ...scope, order, kind: item.kind };
  if (item.kind === 'event') return [base];
  return lowerFragment(item, base);
}

/**
 * A branch's written ID, or else `<fragment>-branch-<n>`: `n` is the branch's position among all
 * of the `alt`'s branches, counting from 1.
 */
function branchId(
  fragment: string,
  branch: Declaration,
  index: number,
): string {
  if (branch.fields.id !== undefined) return id(branch.fields);
  return `${fragment}-branch-${index + 1}`;
}

/** An `alt` fragment (see {@link lowerAlternatives}); any other must not contain branches. */
function lowerFragment(
  item: Declaration,
  base: RawRecord,
): readonly RawRecord[] {
  if (text(item.fields, 'operator') === 'alt') return lowerAlternatives(item, base);
  if (item.children.some((child) => child.kind === 'branch'))
    reject('syntax', item.span, 'event or fragment', 'Only alt contains branches');
  return [{ ...base, branches: [] }, ...lowerSequence(item.children, { parent: id(item.fields) })];
}

/**
 * An `alt` fragment: only branches inside. The fragment lists its branches (ID and label) in
 * order; then each branch's contents follow, with `parent` and `branch` set.
 */
function lowerAlternatives(
  item: Declaration,
  base: RawRecord,
): readonly RawRecord[] {
  if (item.children.some((child) => child.kind !== 'branch'))
    reject('syntax', item.span, 'branch', 'Alt contains only named branches');
  const parent = id(item.fields);
  const branches = item.children.map((branch, index) => ({
    id: branchId(parent, branch, index),
    label: text(branch.fields, 'label'),
  }));
  const nested = item.children.flatMap((branch, index) =>
    lowerSequence(branch.children, { parent, ...optional('branch', branches[index]?.id) }),
  );
  return [{ ...base, branches }, ...nested];
}
