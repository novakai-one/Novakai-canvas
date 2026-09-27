/*
 * The build-spec profile vocabulary: the profiles the CLI knows, the descriptor `profile describe`
 * prints, the rule code on every lint finding and the lint result. Pure declarations plus the
 * profile check; core builds and reads them.
 */
import { z } from 'zod';
import type { Mode, Span } from './foreign.js';

/** Every profile the CLI knows. `profile describe|scaffold|lint` accept only these (`unknown-profile`). */
export const profileId = z.enum(['build-spec@1']);

/** A profile that passed {@link profileId}. */
export type ProfileId = z.infer<typeof profileId>;

/** Section modes a slot or appendix accepts; the first is the one a required slot must use. */
export type ProfileModes = readonly [Mode, ...Mode[]];

/** One required logical document: a section `@id` with a fixed place in the order. */
export interface ProfileSlot {
  readonly id: string;
  readonly order: number;
  readonly modes: ProfileModes;
  readonly description: string;
}

/** What `profile describe` prints and lint reads its slots from. */
export interface ProfileDescriptor {
  readonly id: ProfileId;
  readonly name: string;
  readonly description: string;
  readonly commands: Readonly<Record<'describe' | 'scaffold' | 'lint', string>>;
  readonly slots: readonly ProfileSlot[];
  readonly appendix: {
    readonly idPattern: string;
    readonly modes: ProfileModes;
    readonly description: string;
  };
  readonly conventions: readonly string[];
  readonly notes: readonly string[];
}

/**
 * The rule a lint finding breaks. Consumers branch on the code, never on the message.
 *
 * Sections:
 * - `duplicate-section`: a section ID is used twice.
 * - `reserved-slot-mode`: a section with a required slot's ID uses a mode that slot does not allow.
 * - `missing-section`: a required slot has no section.
 * - `section-mode`: a required section does not use its slot's first mode.
 * - `section-order`: a required section's order does not increase after the previous one.
 * - `missing-appendix`: no `@flow-5N`, `@sequence-5N` or `@state-5N` appendix.
 * - `duplicate-appendix-number`: two appendices share a number.
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
  | 'reserved-slot-mode'
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

/** One broken rule: its code, the declaration path it names, the message and where it is. */
export interface ProfileFinding {
  readonly code: ProfileRuleCode;
  readonly path: string;
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
