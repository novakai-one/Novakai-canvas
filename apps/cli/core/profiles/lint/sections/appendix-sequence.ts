/*
 * Appendix sequence rules of the build-spec profile: at least one appendix exists, and in numeric
 * order the appendices number, mode and order correctly after the ownership section. Pure; the
 * findings are returned.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../../contract/records/profiles.js';
import { collectAppendices, type Appendix } from '../appendix-ids.js';
import { order, sectionById, text, type Declaration } from '../declarations.js';
import { fieldFinding, findingAt } from '../findings.js';

/** The sequential appendix-check state: numbers seen and the running order anchor. */
type AppendixSequence = {
  readonly numbers: Set<number>;
  previousNumber: number;
  previousOrder: number | undefined;
  readonly findings: ProfileFinding[];
};

/** Appendix presence findings, then the sequential number, mode and order findings. */
export function lintAppendixShape(indexed: ProfileDeclarationIndex): ProfileFinding[] {
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
