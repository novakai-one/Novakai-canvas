/*
 * Lowering a section: its mode and layout, its `show` appearances and `group`s, its `connect`
 * wire preferences, its sequence items and a tree's `root`. No coordinates are produced. No
 * writes, so a retry gives the same result. Language owns correcting the source; Authoring owns
 * commit recovery.
 */
import type { Declaration } from '../../contract/records/syntax.js';
import { lowerRecord } from './content.js';
import { id, list, optional, textOr, withoutField, type RawRecord } from './fields.js';
import { lowerLayout, modeLayout } from './layout.js';
import { lowerSequence } from './sequence.js';
import { lowerValue } from './properties.js';
import { partitionLayout } from './layout-fields.js';
import type { Result } from '../../contract/errors.js';
import { accepted, protect, reject, origin } from '../validation/outcomes.js';

/** The appearances and groups gathered from one layout scope. */
interface ViewParts {
  /** One appearance per object listed by a `show`, in written order. */
  readonly appearances: readonly RawRecord[];

  /** Every group, each before its nested groups. */
  readonly groups: readonly RawRecord[];
}

/**
 * Lowers a section. The mode defaults to `flow`. The section's layout algorithm is its written
 * `layout=`, or else the mode's (see `modeLayout`). A group without its own `layout=` uses the
 * mode's algorithm, even when the section writes a different `layout=`.
 */
export function lowerSection(item: Declaration): Result<RawRecord> {
  return protect(() => {
    const mode = textOr(item.fields, 'mode', 'flow');
    const views = lowerViews(item.children, modeLayout(mode));
    return {
      ...partitionLayout(lowerRecord(item)).remaining,
      mode,
      layout: accepted(lowerLayout(item.fields, item.children, modeLayout(mode))),
      ...views,
      wires: lowerWires(item.children),
      sequence: lowerSequence(item.children),
      ...rootField(item.children),
    };
  });
}

/**
 * Lowers a `show` statement: one appearance per listed object, each with the same written
 * preferences (role, size, frame and so on).
 */
function lowerShows(
  item: Declaration,
  group?: string,
): Result<readonly RawRecord[]> {
  return protect(() => {
    const preferences = preferencesOf(item);
    const ids = list(item.fields, 'ids');
    return ids.map((value) => ({
      object: lowerValue(value, 'id'),
      ...preferences,
      ...optional('group', group),
    }));
  });
}

/**
 * Lowers a `connect` statement: one wire preference per listed wire. It refers to existing
 * wires and never creates one.
 */
function lowerConnections(item: Declaration): Result<readonly RawRecord[]> {
  return protect(() => {
    const preferences = preferencesOf(item);
    const ids = list(item.fields, 'ids');
    return ids.map((value) => ({
      relationship: lowerValue(value, 'id'),
      ...preferences,
    }));
  });
}

/** The wire preferences of every `connect` statement, in written order. */
function lowerWires(children: readonly Declaration[]): readonly RawRecord[] {
  const connects = children.filter((child) => child.kind === 'connect');
  return connects.flatMap((child) => accepted(lowerConnections(child)));
}

/** A `show` or `connect` record without its `ids`: the preferences shared by every listed ID. */
function preferencesOf(item: Declaration): RawRecord {
  return withoutField(lowerRecord(item), 'ids');
}

/** Joins two scopes' parts into new arrays; neither input is changed. */
function mergeViews(
  left: ViewParts,
  right: ViewParts,
): ViewParts {
  return {
    appearances: [...left.appearances, ...right.appearances],
    groups: [...left.groups, ...right.groups],
  };
}

/**
 * A group: its record (without layout attributes, with `parent` and `layout`), then its nested
 * groups; the appearances come from its contents.
 */
function lowerGroup(
  item: Declaration,
  algorithm: string,
  parent?: string,
): ViewParts {
  const group = {
    ...lowerRecord(item),
    ...optional('parent', parent),
    layout: accepted(lowerLayout(item.fields, item.children, algorithm)),
  };
  const clean = partitionLayout(group).remaining;
  const nested = lowerViews(item.children, algorithm, id(item.fields));
  return { appearances: nested.appearances, groups: [clean, ...nested.groups] };
}

/** The parts of one scope's statements, in written order. */
function lowerViews(
  children: readonly Declaration[],
  algorithm: string,
  parent?: string,
): ViewParts {
  const parts = children.map((item) => lowerView(item, algorithm, parent));
  return parts.reduce(mergeViews, { appearances: [], groups: [] });
}

/** A `show` gives appearances; a `group` gives groups; other statements give nothing here. */
function lowerView(
  item: Declaration,
  algorithm: string,
  parent?: string,
): ViewParts {
  if (item.kind === 'show') return { appearances: accepted(lowerShows(item, parent)), groups: [] };
  if (item.kind === 'group') return lowerGroup(item, algorithm, parent);
  return { appearances: [], groups: [] };
}

/** `{ root }` for a tree's single `root`, or nothing; a second `root` is rejected. */
function rootField(children: readonly Declaration[]): RawRecord {
  const roots = children.filter((item) => item.kind === 'root');
  if (roots.length > 1)
    reject('syntax', roots[1]?.span ?? origin, 'One tree root', 'Duplicate root');
  const root = roots[0];
  if (root === undefined) return {};
  return { root: id(root.fields) };
}
