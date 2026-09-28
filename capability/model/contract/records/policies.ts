/*
 * Acceptance policy tables, published as data: Model's validators read them, `describe()`
 * publishes them, and agents can learn every rule without reading core. In `compatibleWires`,
 * `sourceEndpoints` and `targetEndpoints` an absent entry allows any value; an absent
 * `memberEndpoints` entry falls back to `genericMemberEndpoints`; `compatibleLayouts` has an
 * entry for every mode. In every table an empty list allows none.
 *
 * The tables are typed read-only but are ordinary, unfrozen objects shared by every caller.
 * Validation is pure; Authoring owns correction, commit and recovery.
 */
import type { LayoutIntent } from './layout.js';
import type { RelationshipKind } from './relationship.js';
import type { Mode } from './section.js';
import type { ObjectKind } from './object.js';
import type { ContentBlock } from './content.js';

/** The kinds of object member a relationship endpoint can address. */
export type MemberEndpointKind =
  Extract<ContentBlock['kind'], 'field' | 'member' | 'signature'> | 'port' | 'row';

/**
 * The layout algorithms each section mode allows. Applies to a section's layout and to its
 * groups' layouts.
 */
export const compatibleLayouts: Readonly<Record<Mode, readonly LayoutIntent['algorithm'][]>> = {
  flow: ['flow', 'layered'],
  state: ['flow', 'layered'],
  er: ['layered', 'grid'],
  modules: ['layered', 'grid'],
  tree: ['tree'],
  sequence: ['sequence'],
  story: ['grid'],
  grid: ['grid'],
};

/**
 * The relationship kinds each section mode may draw as wires. Modes without an entry (`flow`,
 * `story`, `grid`) allow every kind; `sequence` allows none.
 */
export const compatibleWires: Readonly<Partial<Record<Mode, readonly RelationshipKind[]>>> = {
  er: ['association', 'reference'],
  modules: ['imports', 'calls', 'implements', 'contains', 'reference'],
  state: ['transition', 'reference'],
  tree: ['parent', 'reference'],
  sequence: [],
};

/**
 * The member kinds an endpoint can address, per owner object kind. Kinds without an entry use
 * {@link genericMemberEndpoints}.
 */
export const memberEndpoints: Readonly<Partial<Record<ObjectKind, readonly MemberEndpointKind[]>>> =
  {
    entity: ['field', 'port'],
    module: ['member', 'signature', 'port'],
    interface: ['member', 'signature', 'port'],
    function: ['member', 'signature', 'port'],
  };

/** The member kinds addressable on an object whose kind has no {@link memberEndpoints} entry. */
export const genericMemberEndpoints: readonly MemberEndpointKind[] = ['port', 'row'];

/**
 * The object kinds allowed as a relationship's source, per relationship kind. Kinds without an
 * entry allow any source.
 */
export const sourceEndpoints: Readonly<Partial<Record<RelationshipKind, readonly ObjectKind[]>>> = {
  association: ['entity'],
  imports: ['module'],
  calls: ['module', 'function'],
  implements: ['module', 'function'],
  contains: ['module', 'system'],
  transition: ['start', 'state'],
};

/**
 * The object kinds allowed as a relationship's target, per relationship kind. Kinds without an
 * entry allow any target. Differs from {@link sourceEndpoints} by design (for example
 * `contains` restricts only its source).
 */
export const targetEndpoints: Readonly<Partial<Record<RelationshipKind, readonly ObjectKind[]>>> = {
  association: ['entity'],
  imports: ['module', 'interface', 'function'],
  calls: ['module', 'interface', 'function'],
  implements: ['interface'],
  transition: ['state', 'end'],
};
