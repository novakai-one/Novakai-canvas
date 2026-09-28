/*
 * The build-spec@1 profile descriptor: the four required slots, the appendix rule, the structural
 * conventions and the notes. Pure, frozen data. Hosts print it; every lint rule reads its section
 * IDs and its appendix rule from here. Every appendix ID in the prose is built from the rule's
 * number and modes by `appendixIdForms`.
 */
import { sectionId } from '../../../contract/brands.js';
import type { Mode } from '../../../contract/ports/model.js';
import type {
  DocumentNumber,
  ProfileAppendix,
  ProfileDescriptor,
  ProfileModes,
  ProfileSlot,
} from '../../../contract/records/profiles.js';

/** The four required documents of build-spec@1. */
export type BuildSpecSlot = 'repo' | 'entities' | 'modules' | 'ownership';

/** The required slots by document. Every rule reads a slot's section ID from here. */
export const buildSpecSlots: Readonly<Record<BuildSpecSlot, ProfileSlot>> = Object.freeze({
  repo: requiredSlot('repo', 1, 'tree', 'Repo tree with scoped NEW/CHANGE/REUSE labels.'),
  entities: requiredSlot('entities', 2, 'er', 'Entities with explicit fields and invariant text.'),
  modules: requiredSlot(
    'modules',
    3,
    'modules',
    'Interfaces and signatures reusing canonical repo objects.',
  ),
  ownership: requiredSlot(
    'ownership',
    4,
    'grid',
    'One Object/Create/Read/Update/Delete table row per entity.',
  ),
});

/** The modes an appendix may use; each is also its ID prefix. */
const appendixModes: ProfileModes = Object.freeze(['flow', 'sequence', 'state'] as const);

/** Appendices share document 5: section `@flow-51` is appendix 5.1. */
const appendixNumber: DocumentNumber = 5;

/** The appendix rule. The lint's appendix ID check and every appendix ID in the prose read it. */
export const buildSpecAppendix: ProfileAppendix = Object.freeze({
  number: appendixNumber,
  modes: appendixModes,
  description: `At least one numbered ${appendixNumber}.N ${joinedWithOr(appendixModes)} appendix.`,
});

/** build-spec@1: five logical documents in one ordinary collection. */
export const buildSpecProfile: ProfileDescriptor = Object.freeze({
  id: 'build-spec@1',
  name: 'Build specification',
  description: 'A five-document convention for readable implementation plans.',
  slots: Object.freeze([
    buildSpecSlots.repo,
    buildSpecSlots.entities,
    buildSpecSlots.modules,
    buildSpecSlots.ownership,
  ]),
  appendix: buildSpecAppendix,
  conventions: Object.freeze([
    'Required section numeric orders must increase: repo < entities < modules < ownership < every appendix; extra sections may appear anywhere.',
    `Appendix IDs use ${appendixIdForms(buildSpecAppendix)}; the prefix must match the native mode and N is positive.`,
    'CRUD row IDs are @<entity-id>-row, exactly one five-cell row for each entity shown in @entities.',
    'Extra non-profile sections are preserved and do not satisfy or invalidate a reserved profile slot.',
  ]),
  notes: Object.freeze([
    'These are logical documents in one ordinary collection, not five files.',
    'Sequence lifelines reuse canonical modules; interface lifelines use a linked participant proxy.',
    'Lint checks structure only; it does not certify prose, implementation completeness or rendering.',
  ]),
});

/**
 * The appendix ID forms as prose, one per mode, built from the rule's modes and number:
 * `@flow-5N, @sequence-5N or @state-5N`. The `missing-appendix` message and the conventions use it.
 */
export function appendixIdForms(appendix: ProfileAppendix): string {
  const forms = appendix.modes.map((mode) => `@${mode}-${appendix.number}N`);
  return joinedWithOr(forms);
}

/**
 * One frozen required slot. `id` is a fixed literal above, so Model's `sectionId` always accepts
 * it; this runs once, when the module loads.
 */
function requiredSlot(
  id: BuildSpecSlot,
  number: DocumentNumber,
  mode: Mode,
  description: string,
): ProfileSlot {
  return Object.freeze({ id: sectionId.parse(id), number, mode, description });
}

/** Words as an English list ending in `or`: `a`, `a or b`, `a, b or c`; empty for no words. */
function joinedWithOr(words: readonly string[]): string {
  const lastWord = words.at(-1) ?? '';
  const leading = words.slice(0, -1);
  if (leading.length === 0) return lastWord;
  return `${leading.join(', ')} or ${lastWord}`;
}
