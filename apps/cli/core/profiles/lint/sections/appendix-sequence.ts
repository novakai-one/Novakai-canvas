/*
 * Appendix sequence rules of the build-spec profile: at least one appendix exists, and in numeric
 * order each appendix has a number no earlier appendix used, the mode its ID prefix names, and an
 * order above ownership and the appendix before it. Pure: one immutable fold; the findings are
 * returned.
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

/** The fold state: the anchors the next appendix is checked against, and the findings so far. */
interface AppendixSequence {
  /** The number of the appendix just visited; `undefined` before the first. */
  readonly previousNumber: number | undefined;
  /** The order the next appendix must exceed: the last order seen, starting at ownership's. */
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

/**
 * Number, mode and order findings over the appendices in numeric order. The sort is stable, so
 * appendices that share a number keep their document order.
 */
function appendixSequenceFindings(
  appendices: readonly Appendix[],
  sections: readonly Declaration[],
): readonly ProfileFinding[] {
  const start: AppendixSequence = {
    previousNumber: undefined,
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
 * number becomes the number anchor, and its order becomes the order anchor when it has one.
 */
function visitAppendix(
  sequence: AppendixSequence,
  appendix: Appendix,
): AppendixSequence {
  const currentOrder = order(appendix.section);
  return {
    previousNumber: appendix.number,
    previousOrder: currentOrder ?? sequence.previousOrder,
    findings: [
      ...sequence.findings,
      ...duplicateNumberFinding(appendix, sequence.previousNumber),
      ...appendixModeFinding(appendix),
      ...appendixOrderFinding(appendix, currentOrder, sequence.previousOrder),
    ],
  };
}

/**
 * A number an earlier appendix already used is a duplicate. The appendices arrive sorted by
 * number, so an earlier use is always the appendix just before. Reported once per repeat.
 */
function duplicateNumberFinding(
  appendix: Appendix,
  previousNumber: number | undefined,
): readonly ProfileFinding[] {
  return appendix.number === previousNumber
    ? [
        fieldFinding(appendix.section, 'id', {
          code: 'duplicate-appendix-number',
          path: `section @${appendix.id}`,
          message: 'Appendix number is duplicated.',
        }),
      ]
    : [];
}

/** An appendix ID prefix fixes the section's mode. */
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

/** An appendix's order must exceed the order anchor; a missing order on either side fails. */
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
