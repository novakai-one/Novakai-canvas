/*
 * Default values and closed word lists shared by the grammar, lowering, patching and `describe`.
 * Plain data, deep-frozen when the module loads, so no caller can change them. Language owns
 * correcting the source; Authoring owns commit recovery.
 */
import type { Action } from '../../contract/records/syntax.js';
import { deepFreeze } from '../validation/ownership.js';

/**
 * The layout algorithm each section `mode` uses when the section names none. Its keys are every
 * section mode, in the order the `mode=` values list them. Lowering reads it (unknown modes fall
 * back to `flow` there), patching reads it through lowering when a layout is reset, and
 * `describe` publishes it.
 */
export const modeLayouts: Readonly<Record<string, string>> = deepFreeze({
  flow: 'flow',
  er: 'layered',
  modules: 'layered',
  tree: 'tree',
  sequence: 'sequence',
  state: 'flow',
  story: 'grid',
  grid: 'grid',
});

/**
 * The values used when the source leaves a setting out. `describe` publishes the whole record;
 * the property vocabulary uses them as fallbacks, and lowering uses `direction`, `gap` and
 * `collectionLayout`. Read-only in its type too.
 */
export const defaults = deepFreeze({
  theme: 'paper',
  role: 'neutral',
  size: 'medium',
  mode: 'flow',
  direction: 'right',
  gap: 'normal',
  collectionLayout: 'grid',
  sourceStatus: 'unverified',
} as const);

/** Every node kind, the word after a node's ID (as in `node @a step "Label"`). */
export const nodeKinds: readonly string[] = deepFreeze([
  'step',
  'start',
  'end',
  'decision',
  'fork',
  'join',
  'entity',
  'module',
  'interface',
  'function',
  'state',
  'participant',
  'concept',
  'system',
  'note',
]);

/** Every wire kind, written as a wire's `kind=` attribute. */
export const relationshipKinds: readonly string[] = deepFreeze([
  'flow',
  'association',
  'imports',
  'calls',
  'implements',
  'contains',
  'parent',
  'reference',
  'transition',
]);

/**
 * The actions that change a section's membership (`show @a in @s`, and `hide`, `connect`,
 * `disconnect`). Parsing reads them after an action word; patching routes them to membership.
 */
export const membershipActions: readonly Action[] = deepFreeze([
  'show',
  'hide',
  'connect',
  'disconnect',
]);

/**
 * The Model namespace each whole-record patch target is stored in. Patching reads it to name the
 * namespace of a `replace`, `create` or `remove` change.
 */
export const recordNamespaces: Readonly<Record<RecordTarget, string>> = deepFreeze({
  node: 'objects',
  wire: 'relationships',
  section: 'sections',
  asset: 'assets',
  source: 'sources',
});

/** A patch target stored as whole records in one Model namespace. */
export type RecordTarget = 'node' | 'wire' | 'section' | 'asset' | 'source';
