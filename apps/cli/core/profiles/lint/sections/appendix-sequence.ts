/*
 * Section rules of the build-spec profile: unique ids, required slots present with their mode,
 * required sections in increasing order, and appendix ids that number, mode and order correctly.
 * Each rule returns its findings; nothing is pushed into shared state.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../../contract/records/profiles.js';
import { buildSpecProfile } from '../../build-spec/starter.js';
import {
  collectAppendices,
  fieldFinding,
  findingAt,
  id,
  order,
  sectionById,
  text,
  type Appendix,
  type Declaration,
} from '../declarations.js';

/** A required slot whose section is present. */
type RequiredSection = {
  readonly slot: (typeof buildSpecProfile.slots)[number];
  readonly section: Declaration;
};

/** The sequential appendix-check state: numbers seen and the running order anchor. */
type AppendixSequence = {
  readonly numbers: Set<number>;
  previousNumber: number;
  previousOrder: number | undefined;
  readonly findings: ProfileFinding[];
};

const reserved = new Map(buildSpecProfile.slots.map((slot) => [slot.id.slice(1), slot]));

/** Identity, presence, order and appendix-shape findings for the section list. */
export function lintSections(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  return [
    ...lintSectionIdentity(indexed),
    ...lintRequiredSections(indexed),
    ...lintRequiredOrder(indexed),
    ...lintAppendixShape(indexed),
  ];
}

/** Duplicate-id and reserved-mode findings, tracked across the section list. */
function lintSectionIdentity(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const seen = new Map<string, Declaration>();
  const findings: ProfileFinding[] = [];
  for (const section of indexed.sections) {
    findings.push(...identifySection(seen, section));
  }
  return findings;
}

/** One section's identity findings, remembering its id for the sections after it. */
function identifySection(
  seen: Map<string, Declaration>,
  section: Declaration,
): ProfileFinding[] {
  const sectionId = id(section);
  if (sectionId === undefined) return [];
  const findings = [
    ...duplicateFinding(seen, section, sectionId),
    ...reservedModeFinding(section, sectionId),
  ];
  seen.set(sectionId, section);
  return findings;
}

/** A section id already seen is a duplicate. */
function duplicateFinding(
  seen: ReadonlyMap<string, Declaration>,
  section: Declaration,
  sectionId: string,
): ProfileFinding[] {
  return seen.has(sectionId)
    ? [fieldFinding(section, 'id', `section @${sectionId}`, 'Section ID is duplicated.')]
    : [];
}

/** A required slot's section must use one of the slot's modes. */
function reservedModeFinding(
  section: Declaration,
  sectionId: string,
): ProfileFinding[] {
  const slot = reserved.get(sectionId);
  const mode = text(section, 'mode');
  return slot !== undefined && mode !== undefined && !slot.modes.includes(mode)
    ? [
        fieldFinding(
          section,
          'mode',
          `section @${sectionId}`,
          `Required slot must use mode ${slot.modes.join(' or ')}.`,
        ),
      ]
    : [];
}

/** Every required slot must be present and carry its first mode. */
function lintRequiredSections(indexed: ProfileDeclarationIndex): ProfileFinding[] {
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
function lintRequiredOrder(indexed: ProfileDeclarationIndex): ProfileFinding[] {
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

/** Appendix presence findings, then the sequential number, mode and order findings. */
function lintAppendixShape(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const appendices = collectAppendices(indexed.sections);
  return [
    ...appendixPresenceFinding(appendices.length, indexed.declaration),
    ...appendixSequenceFindings(appendices, indexed.sections),
  ];
}

/** At least one appendix section is required. */
function appendixPresenceFinding(
  count: number,
  declaration: Declaration,
): ProfileFinding[] {
  return count === 0
    ? [
        findingAt(
          declaration,
          'appendices',
          'At least one @flow-5N, @sequence-5N or @state-5N appendix is required.',
        ),
      ]
    : [];
}

/** Number, mode and order findings over the appendices in numeric order. */
function appendixSequenceFindings(
  appendices: readonly Appendix[],
  sections: readonly Declaration[],
): ProfileFinding[] {
  const sequence: AppendixSequence = {
    numbers: new Set<number>(),
    previousNumber: 0,
    previousOrder: ownershipOrder(sections),
    findings: [],
  };
  for (const appendix of appendices.toSorted((a, b) => a.number - b.number)) {
    visitAppendix(appendix, sequence);
  }
  return sequence.findings;
}

/** The ownership section's order anchors the appendix sequence. */
function ownershipOrder(sections: readonly Declaration[]): number | undefined {
  const ownership = sectionById(sections, 'ownership');
  return ownership === undefined ? undefined : order(ownership);
}

/** One appendix's findings, advancing the number and order anchors. */
function visitAppendix(
  appendix: Appendix,
  sequence: AppendixSequence,
): void {
  sequence.findings.push(
    ...appendixNumberFindings(appendix, sequence.numbers, sequence.previousNumber),
  );
  sequence.numbers.add(appendix.number);
  sequence.previousNumber = appendix.number;
  sequence.findings.push(...appendixModeFinding(appendix));
  const currentOrder = order(appendix.section);
  sequence.findings.push(...appendixOrderFinding(appendix, currentOrder, sequence.previousOrder));
  if (currentOrder !== undefined) sequence.previousOrder = currentOrder;
}

/** Duplicate number first, then out-of-sequence — the order a reader meets them. */
function appendixNumberFindings(
  appendix: Appendix,
  numbers: ReadonlySet<number>,
  previous: number,
): ProfileFinding[] {
  return [
    ...duplicateNumberFinding(appendix, numbers),
    ...increasingNumberFinding(appendix, previous),
  ];
}

/** An appendix number already used is a duplicate. */
function duplicateNumberFinding(
  appendix: Appendix,
  numbers: ReadonlySet<number>,
): ProfileFinding[] {
  return numbers.has(appendix.number)
    ? [
        fieldFinding(
          appendix.section,
          'id',
          `section @${appendix.id}`,
          'Appendix number is duplicated.',
        ),
      ]
    : [];
}

/** Appendix numbers must strictly increase in id order. */
function increasingNumberFinding(
  appendix: Appendix,
  previous: number,
): ProfileFinding[] {
  return appendix.number <= previous
    ? [
        fieldFinding(
          appendix.section,
          'id',
          `section @${appendix.id}`,
          'Appendix numbers must increase.',
        ),
      ]
    : [];
}

/** An appendix id prefix fixes the section's mode. */
function appendixModeFinding(appendix: Appendix): ProfileFinding[] {
  return text(appendix.section, 'mode') === appendix.mode
    ? []
    : [
        fieldFinding(
          appendix.section,
          'mode',
          `section @${appendix.id}`,
          `Appendix ID prefix requires mode ${appendix.mode}.`,
        ),
      ];
}

/** Appendices order after ownership and strictly increase. */
function appendixOrderFinding(
  appendix: Appendix,
  current: number | undefined,
  previous: number | undefined,
): ProfileFinding[] {
  return current !== undefined && previous !== undefined && current > previous
    ? []
    : [
        fieldFinding(
          appendix.section,
          'order',
          `section @${appendix.id}`,
          'Appendix order must be greater than the ownership order and strictly increasing.',
        ),
      ];
}
