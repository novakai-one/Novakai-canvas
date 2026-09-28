import type { Collection } from './records/collection.js';
import type { Change } from './records/change.js';

/** The collection's record lists that changes can target and impact reports name. */
export type Target =
  'objects' | 'relationships' | 'sections' | 'assets' | 'sources' | 'definitions';

/**
 * One net change between the snapshot and the planned candidate. Reported per record list in
 * target order (objects, relationships, sections, assets, sources, definitions): additions, then
 * removals, then updates; a collection metadata update comes last.
 */
export interface Impact {
  /** The record list, or `collection` for the collection's own fields (title, theme and so on). */
  readonly target: Target | 'collection';
  /** The record's ID, or the collection's ID for `collection`. */
  readonly id: string;
  /**
   * `added` or `removed` by ID; `updated` when the record's JSON differs (array order and
   * explicit overrides count).
   */
  readonly action: 'added' | 'updated' | 'removed';
}

/**
 * A planned transition: a detached valid candidate and its net impact. The revision is unchanged;
 * Authoring owns admission, commit and crash recovery.
 */
export interface ChangePlan {
  /** The collection after every change, validated as a whole. */
  readonly candidate: Collection;
  /** The net changes from the snapshot to the candidate. */
  readonly impact: readonly Impact[];
}

/**
 * A staged transition for the language compiler. Its references may be unresolved; only a plan
 * proves validity.
 */
export interface ChangeStage {
  /** Always `unchecked`: the candidate has not been validated as a whole. */
  readonly validity: 'unchecked';
  /** The collection after every change, not validated. */
  readonly candidate: Collection;
  /** The changes as parsed by the change schema (defaults filled in). */
  readonly changes: readonly Change[];
}
