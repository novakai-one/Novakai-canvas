/*
 * Required-section rules of the build-spec profile: every required slot is present with its first
 * mode, and the required sections carry increasing order fields. Pure; each rule returns its
 * findings.
 */
import type { ProfileFinding, ProfileSlot } from '../../../../contract/records/profiles.js';
import { buildSpecProfile } from '../../build-spec/descriptor.js';
import {
  order,
  sectionById,
  text,
  type Declaration,
  type DeclarationIndex,
} from '../declarations.js';
import { fieldFinding, findingAt } from '../findings.js';

/** A required slot whose section is present. */
type RequiredSection = {
  readonly slot: ProfileSlot;
  readonly section: Declaration;
};

/** Every required slot must be present and carry its first mode. */
export function lintRequiredSections(indexed: DeclarationIndex): readonly ProfileFinding[] {
  return buildSpecProfile.slots.flatMap((slot) => requiredSectionFinding(slot, indexed));
}

/**
 * The missing or wrong-mode finding for one required slot: `missing-section` when no section has
 * the slot's ID, `section-mode` when the first such section's mode is absent or not the slot's
 * first mode. The only mode rule for required slots.
 */
function requiredSectionFinding(
  slot: ProfileSlot,
  indexed: DeclarationIndex,
): readonly ProfileFinding[] {
  const section = slotSection(slot, indexed.sections);
  if (section === undefined)
    return [
      findingAt(indexed.declaration, {
        code: 'missing-section',
        path: `section ${slot.id}`,
        message: `Missing required ${slot.id} section.`,
      }),
    ];
  if (text(section, 'mode') === slot.modes[0]) return [];
  return [
    fieldFinding(section, 'mode', {
      code: 'section-mode',
      path: `section ${slot.id}`,
      message: `Expected mode ${slot.modes[0]}.`,
    }),
  ];
}

/** The first section whose ID is the slot's ID without its `@`. */
function slotSection(
  slot: ProfileSlot,
  sections: readonly Declaration[],
): Declaration | undefined {
  return sectionById(sections, slot.id.slice(1));
}

/** Consecutive required sections must carry increasing order fields. */
export function lintRequiredOrder(indexed: DeclarationIndex): readonly ProfileFinding[] {
  const required = presentRequired(indexed);
  return required
    .slice(1)
    .flatMap((current, index) => requiredOrderFinding(required[index], current));
}

/** The required slots whose sections exist, in slot order. */
function presentRequired(indexed: DeclarationIndex): readonly RequiredSection[] {
  return buildSpecProfile.slots.flatMap((slot) => {
    const section = slotSection(slot, indexed.sections);
    return section === undefined ? [] : [{ slot, section }];
  });
}

/** A required section must order after the previous required section. */
function requiredOrderFinding(
  previous: RequiredSection | undefined,
  current: RequiredSection,
): readonly ProfileFinding[] {
  if (previous === undefined) return [];
  if (orderIncreases(previous.section, current.section)) return [];
  return [
    fieldFinding(current.section, 'order', {
      code: 'section-order',
      path: `section ${current.slot.id}`,
      message: `Required section order must increase after ${previous.slot.id}; extra sections may appear anywhere.`,
    }),
  ];
}

/** Both orders exist and the current one is larger. */
function orderIncreases(
  previous: Declaration,
  current: Declaration,
): boolean {
  const previousOrder = order(previous);
  const currentOrder = order(current);
  return previousOrder !== undefined && currentOrder !== undefined && currentOrder > previousOrder;
}
