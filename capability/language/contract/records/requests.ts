/*
 * The requests Language's operations take and the records they return: lowering, expanding a
 * recipe and printing. Also re-exports the parsed resource request and source mapping records.
 * Language owns correcting the source; Authoring owns every commit and recovery.
 */
import type { Collection, Change } from '@novakai/canvas-model';
import type { ResourceRequest, SourceMapping } from './syntax.js';

export type { ResourceRequest, SourceMapping } from './syntax.js';

/**
 * Themes and assets the host has already resolved. Language only reads these; it never looks a
 * resource up or opens its source.
 */
export interface ResolvedResources {
  /**
   * Themes by the name or pin the source uses. If no key matches a requested pin, the theme
   * whose own pin equals it is used.
   */
  readonly themes: Readonly<Record<string, Collection['theme']>>;

  /** Admitted assets by asset ID. */
  readonly assets: Readonly<Record<string, Collection['assets'][number]>>;
}

/** What `lower` compiles: source, how to apply it, and what it applies to. */
export interface LowerRequest {
  /** The `canvas 1` or `patch 1` source. */
  readonly source: string;

  /**
   * `create` and `replace` take `canvas 1` source; `patch` takes `patch 1` source. `create`
   * needs `snapshot` to be `null`; `replace` and `patch` need the snapshot with the same ID.
   */
  readonly mode: 'create' | 'replace' | 'patch';

  /** The current collection, or `null` when there is none. */
  readonly snapshot: Collection | null;

  /** The themes and assets the source asks for, already resolved. */
  readonly resources: ResolvedResources;
}

/** What `lower` and `expand` return: a checked collection and the changes that produce it. */
export interface LoweredIntent {
  /** The mode used; `expand` always uses `create`. */
  readonly mode: LowerRequest['mode'];

  /** The collection after the changes, as Model's planner checked it. */
  readonly collection: Collection;

  /** The changes, in order, for Authoring to commit. */
  readonly changes: readonly Change[];

  /** The themes and assets the source asks for. */
  readonly resources: readonly ResourceRequest[];

  /** Where each record was written, for showing later issues in the source. */
  readonly sourceMap: readonly SourceMapping[];
}

/** What to print: the whole collection, one section, or one object with its neighbours. */
export type Scope =
  { readonly kind: 'all' } | { readonly kind: 'section' | 'object'; readonly id: string };

/** What `print` prints. */
export interface PrintRequest {
  /** The collection record; Model validates it before anything is printed. */
  readonly collection: unknown;

  /** The whole collection (full source) or one section or object (a view). */
  readonly scope: Scope;

  /** An optional heading, printed as `#` comment lines above the source. */
  readonly heading?: string;
}

/** A placement or route a person set by hand, listed so a reader knows it is there. */
export interface ManualTarget {
  /** The placed or routed record's address, such as `@section/@object`. */
  readonly target: string;

  /** `placement` for a positioned section, object or group; `route` for a wire. */
  readonly kind: 'placement' | 'route';

  /** Whether the person locked it. */
  readonly locked: boolean;
}

/** What `print` returns. */
export interface Readout {
  /** The printed source (a scoped view cannot be applied). */
  readonly source: string;

  /** The collection ID. */
  readonly collection: string;

  /** The collection's revision. */
  readonly revision: number;

  /** The scope printed. */
  readonly scope: Scope;

  /** The hand-set placements and routes inside the scope. */
  readonly manual: readonly ManualTarget[];

  /** The collection's theme pin, and the digests of the assets inside the scope. */
  readonly pins: { readonly theme: string; readonly assets: readonly string[] };
}

/**
 * What `expand` compiles: a recipe's `canvas 1` source, made into a new collection whose ID is
 * `namespace`. The recipe's own IDs and the references between them are kept as written.
 */
export interface ExpansionRequest {
  /** The recipe's `canvas 1` source. */
  readonly source: string;

  /** The new collection's ID. */
  readonly namespace: string;

  /** The themes and assets the recipe asks for, already resolved. */
  readonly resources: ResolvedResources;
}
