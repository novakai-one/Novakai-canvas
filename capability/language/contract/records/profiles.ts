/*
 * Collection profiles: named conventions an ordinary collection can follow, such as build-spec@1.
 * The profiles Language knows, the descriptor a host prints, what a starter is named with, the
 * rule code on every lint finding and the lint result. Pure declarations; core builds and reads
 * them. Lint only reports: the author corrects the source and lints again.
 */
import type { Mode } from '@novakai/canvas-model';
import type { CollectionId, SectionId } from '../brands.js';
import type { Span } from './syntax.js';

/** Every collection profile Language knows. A host accepts only these. */
export const profileIds = Object.freeze(['build-spec@1'] as const);

/** A collection profile Language knows. */
export type ProfileId = (typeof profileIds)[number];

/** Section modes an appendix may use; each is also the prefix of an appendix's ID. */
export type ProfileModes = readonly [Mode, ...Mode[]];

/**
 * A logical document's number: build-spec@1 numbers its four required slots 1 to 4, and every
 * appendix shares 5 (appendix 5.1, 5.2, ...). A profile with more documents widens this.
 */
export type DocumentNumber = 1 | 2 | 3 | 4 | 5;

/** One required logical document: the section that holds it, its number and its mode. */
export interface ProfileSlot {
  /** The section ID the document uses, without its `@`: slot `repo` is section `@repo`. */
  readonly id: SectionId;
  readonly number: DocumentNumber;
  /** The one mode the section must use. */
  readonly mode: Mode;
  readonly description: string;
}

/** The appendix rule: numbered sections after the required slots, each a flow, sequence or state. */
export interface ProfileAppendix {
  /** The document number every appendix shares: section `@flow-51` is appendix 5.1. */
  readonly number: DocumentNumber;
  /** The appendix ID shape as text, built from `modes` and `number`: `@(flow|sequence|state)-5N`. */
  readonly idPattern: string;
  readonly modes: ProfileModes;
  readonly description: string;
}

/** What a host prints to describe a profile and what lint reads its slots and appendix rule from. */
export interface ProfileDescriptor {
  readonly id: ProfileId;
  readonly name: string;
  readonly description: string;
  /** The required slots, in document order. */
  readonly slots: readonly ProfileSlot[];
  readonly appendix: ProfileAppendix;
  readonly conventions: readonly string[];
  readonly notes: readonly string[];
}

/** What a profile's starter source is named with: the new collection's ID and its title. */
export interface ProfileStarter {
  readonly collection: CollectionId;
  readonly title: string;
}

/**
 * The rule a lint finding breaks. Consumers branch on the code, never on the message.
 *
 * Sections:
 * - `duplicate-section`: a section ID is used twice.
 * - `missing-section`: a required slot has no section.
 * - `section-mode`: a required section does not use its slot's mode.
 * - `section-order`: a required section's order does not increase after the previous one.
 * - `missing-appendix`: no `@flow-5N`, `@sequence-5N` or `@state-5N` appendix.
 * - `duplicate-appendix-number`: an appendix reuses an earlier appendix's number; reported once on
 *   each repeat.
 * - `appendix-mode`: an appendix's mode differs from its ID prefix.
 * - `appendix-order`: an appendix's order is not above ownership and the previous appendix.
 *
 * Repo tree: `repo-root` (not exactly one root with an ID), `repo-root-hidden` (the root is not
 * shown), `repo-wires` (no connected parent wire), `repo-wire-endpoints` (a parent wire lacks an
 * ID, source or target), `repo-wire-hidden` (a parent wire endpoint is not shown),
 * `repo-unreachable` (a shown object is not reachable from the root).
 *
 * Modules and entities: `module-projection` (a shown module is not a canonical module or
 * interface in the repo tree), `entity-kind` (a shown entity is not an entity node),
 * `entity-invariant` (an entity has no invariant text).
 *
 * Ownership: `crud-table` (not exactly one CRUD table), `crud-columns` (columns are not exactly
 * Object, Create, Read, Update, Delete), `crud-row-id` (a row ID is not some entity's
 * `<entity-id>-row`), `crud-cells` (a row does not have one cell per column), `crud-missing-row`
 * (an entity has no row), `crud-duplicate-row` (a row ID is used more than once).
 *
 * Appendix content: `appendix-sequence-content` (no event or fragment), `appendix-native-nodes`
 * (no native node of its mode shown), `appendix-native-wires` (no native wire connected).
 */
export type ProfileRuleCode =
  | 'duplicate-section'
  | 'missing-section'
  | 'section-mode'
  | 'section-order'
  | 'missing-appendix'
  | 'duplicate-appendix-number'
  | 'appendix-mode'
  | 'appendix-order'
  | 'repo-root'
  | 'repo-root-hidden'
  | 'repo-wires'
  | 'repo-wire-endpoints'
  | 'repo-wire-hidden'
  | 'repo-unreachable'
  | 'module-projection'
  | 'entity-kind'
  | 'entity-invariant'
  | 'crud-table'
  | 'crud-columns'
  | 'crud-row-id'
  | 'crud-cells'
  | 'crud-missing-row'
  | 'crud-duplicate-row'
  | 'appendix-sequence-content'
  | 'appendix-native-nodes'
  | 'appendix-native-wires';

/**
 * The declaration a finding names, as text: `section @repo`, `section @repo show @web`,
 * `node @receipt`, `wire @tree-root-web`, `row @receipt-row`, `table` or `appendices`. An ID the
 * source leaves out prints as `?`.
 */
export type ProfilePath =
  | 'appendices'
  | 'table'
  | `section @${string}`
  | `node @${string}`
  | `wire @${string}`
  | `row @${string}`;

/** One broken rule: its code, the declaration it names, the message and where it is. */
export interface ProfileFinding {
  readonly code: ProfileRuleCode;
  readonly path: ProfilePath;
  readonly message: string;
  readonly span: Span;
}

/**
 * The lint outcome. `failed` always carries at least one finding. `unsupported-source`: the source
 * is not a full `canvas 1` document, so no rule ran.
 */
export type ProfileLintResult =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly findings: readonly [ProfileFinding, ...ProfileFinding[]] }
  | { readonly status: 'unsupported-source' };
