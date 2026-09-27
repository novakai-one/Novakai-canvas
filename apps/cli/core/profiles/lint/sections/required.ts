/*
 * Required-section rules of the build-spec profile: every required slot is present with its first
 * mode, and the required sections carry increasing order fields. Pure; each rule returns its
 * findings.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../../contract/records/profiles.js';
import { buildSpecProfile } from '../../build-spec/descriptor.js';
import { order, sectionById, text, type Declaration } from '../declarations.js';
import { fieldFinding, findingAt } from '../findings.js';

/** A required slot whose section is present. */
type RequiredSection = {
  readonly slot: (typeof buildSpecProfile.slots)[number];
  readonly section: Declaration;
};

/** Every required slot must be present and carry its first mode. */
export function lintRequiredSections(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  return buildSpecProfile.slots.flatMap((slot) => requiredSectionFinding(slot, indexed));
}

/** The missing or wrong-mode finding for one required slot. */
function requiredSectionFinding(
  slot: (typeof buildSpecProfile.slots)[number],
  indexed: ProfileDeclarationIndex,
): ProfileFinding[] {
  const section = sectionById(indexed.sections, slot.id.slice(1));
  if (section === undefined)
    return [
      findingAt(indexed.declaration, `section ${slot.id}`, `Missing required ${slot.id} section.`),
    ];
  return text(section, 'mode') === slot.modes[0]
    ? []
    : [fieldFinding(section, 'mode', `section ${slot.id}`, `Expected mode ${slot.modes[0]}.`)];
}

/** Consecutive required sections must carry increasing order fields. */
export function lintRequiredOrder(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const required = presentRequired(indexed);
  return required
    .slice(1)
    .flatMap((current, index) => requiredOrderFinding(required[index], current));
}

/** The required slots whose sections exist, in slot order. */
function presentRequired(indexed: ProfileDeclarationIndex): RequiredSection[] {
  return buildSpecProfile.slots.flatMap((slot) => {
    const section = sectionById(indexed.sections, slot.id.slice(1));
    return section === undefined ? [] : [{ slot, section }];
  });
}

/** A required section must order after the previous required section. */
function requiredOrderFinding(
  previous: RequiredSection | undefined,
  current: RequiredSection,
): ProfileFinding[] {
  if (previous === undefined) return [];
  return orderIncreases(previous.section, current.section)
    ? []
    : [
        fieldFinding(
          current.section,
          'order',
          `section ${current.slot.id}`,
          `Required section order must increase after ${previous.slot.id}; extra sections may appear anywhere.`,
        ),
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
