/*
 * Appendix sequence rules of the build-spec profile: at least one appendix exists, and in numeric
 * order the appendices number, mode and order correctly after the ownership section. Pure; the
 * findings are returned.
 */
import type { ProfileFinding } from '../../../../contract/records/profiles.js';
import { collectAppendices, type Appendix } from '../appendix-ids.js';
import {
  order,
  sectionById,
  text,
  type Declaration,
  type DeclarationIndex,
} from '../declarations.js';
import { fieldFinding, findingAt } from '../findings.js';

/** The appendix fold state: numbers seen, the number and order anchors, and the findings so far. */
interface AppendixSequence {
  readonly numbers: ReadonlySet<number>;
  readonly previousNumber: number;
  readonly previousOrder: number | undefined;
  readonly findings: readonly ProfileFinding[];
}

/** Appendix presence findings, then the sequential number, mode and order findings. */
export function lintAppendixShape(indexed: DeclarationIndex): readonly ProfileFinding[] {
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
): readonly ProfileFinding[] {
  return count === 0
    ? [
        findingAt(declaration, {
          code: 'missing-appendix',
          path: 'appendices',
          message: 'At least one @flow-5N, @sequence-5N or @state-5N appendix is required.',
        }),
      ]
    : [];
}

/** Number, mode and order findings over the appendices in numeric order. */
function appendixSequenceFindings(
  appendices: readonly Appendix[],
  sections: readonly Declaration[],
): readonly ProfileFinding[] {
  const start: AppendixSequence = {
    numbers: new Set<number>(),
    previousNumber: 0,
    previousOrder: ownershipOrder(sections),
    findings: [],
  };
  return appendices.toSorted((a, b) => a.number - b.number).reduce(visitAppendix, start).findings;
}

/** The ownership section's order anchors the appendix sequence. */
function ownershipOrder(sections: readonly Declaration[]): number | undefined {
  const ownership = sectionById(sections, 'ownership');
  return ownership === undefined ? undefined : order(ownership);
}

/**
 * The next fold state: this appendix's number, mode and order findings added in that order, its
 * number recorded, and the order anchor moved to its order when it has one.
 */
function visitAppendix(
  sequence: AppendixSequence,
  appendix: Appendix,
): AppendixSequence {
  const currentOrder = order(appendix.section);
  return {
    numbers: new Set([...sequence.numbers, appendix.number]),
    previousNumber: appendix.number,
    previousOrder: currentOrder ?? sequence.previousOrder,
    findings: [
      ...sequence.findings,
      ...appendixNumberFindings(appendix, sequence.numbers, sequence.previousNumber),
      ...appendixModeFinding(appendix),
      ...appendixOrderFinding(appendix, currentOrder, sequence.previousOrder),
    ],
  };
}

/** Duplicate number first, then out-of-sequence — the order a reader meets them. */
function appendixNumberFindings(
  appendix: Appendix,
  numbers: ReadonlySet<number>,
  previous: number,
): readonly ProfileFinding[] {
  return [
    ...duplicateNumberFinding(appendix, numbers),
    ...increasingNumberFinding(appendix, previous),
  ];
}

/** An appendix number already used is a duplicate. */
function duplicateNumberFinding(
  appendix: Appendix,
  numbers: ReadonlySet<number>,
): readonly ProfileFinding[] {
  return numbers.has(appendix.number)
    ? [
        fieldFinding(appendix.section, 'id', {
          code: 'duplicate-appendix-number',
          path: `section @${appendix.id}`,
          message: 'Appendix number is duplicated.',
        }),
      ]
    : [];
}

/**
 * Appendix numbers must strictly increase in id order. The appendices arrive sorted by number, so
 * this fires only on a repeated number and carries `duplicate-appendix-number`.
 */
function increasingNumberFinding(
  appendix: Appendix,
  previous: number,
): readonly ProfileFinding[] {
  return appendix.number <= previous
    ? [
        fieldFinding(appendix.section, 'id', {
          code: 'duplicate-appendix-number',
          path: `section @${appendix.id}`,
          message: 'Appendix numbers must increase.',
        }),
      ]
    : [];
}

/** An appendix id prefix fixes the section's mode. */
function appendixModeFinding(appendix: Appendix): readonly ProfileFinding[] {
  return text(appendix.section, 'mode') === appendix.mode
    ? []
    : [
        fieldFinding(appendix.section, 'mode', {
          code: 'appendix-mode',
          path: `section @${appendix.id}`,
          message: `Appendix ID prefix requires mode ${appendix.mode}.`,
        }),
      ];
}

/** Appendices order after ownership and strictly increase. */
function appendixOrderFinding(
  appendix: Appendix,
  current: number | undefined,
  previous: number | undefined,
): readonly ProfileFinding[] {
  return current !== undefined && previous !== undefined && current > previous
    ? []
    : [
        fieldFinding(appendix.section, 'order', {
          code: 'appendix-order',
          path: `section @${appendix.id}`,
          message:
            'Appendix order must be greater than the ownership order and strictly increasing.',
        }),
      ];
}
