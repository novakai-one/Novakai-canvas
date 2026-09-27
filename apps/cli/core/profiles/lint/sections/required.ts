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
 * The missing or wrong-mode finding for one required slot. Known overlap: a wrong (not absent)
 * mode is also reported by `reservedModeFinding` (identity.ts) at the same span.
 */
function requiredSectionFinding(
  slot: ProfileSlot,
  indexed: DeclarationIndex,
): readonly ProfileFinding[] {
  const section = sectionById(indexed.sections, slot.id.slice(1));
  if (section === undefined)
    return [
      findingAt(indexed.declaration, {
        code: 'missing-section',
        path: `section ${slot.id}`,
        message: `Missing required ${slot.id} section.`,
      }),
    ];
  return text(section, 'mode') === slot.modes[0]
    ? []
    : [
        fieldFinding(section, 'mode', {
          code: 'section-mode',
          path: `section ${slot.id}`,
          message: `Expected mode ${slot.modes[0]}.`,
        }),
      ];
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
    const section = sectionById(indexed.sections, slot.id.slice(1));
    return section === undefined ? [] : [{ slot, section }];
  });
}

/** A required section must order after the previous required section. */
function requiredOrderFinding(
  previous: RequiredSection | undefined,
  current: RequiredSection,
): readonly ProfileFinding[] {
  if (previous === undefined) return [];
  return orderIncreases(previous.section, current.section)
    ? []
    : [
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
