/*
 * Appendix sections read from their IDs: `@flow-51` is a flow appendix numbered 51. Pure. Owns the
 * `Appendix` type. Its own file because two rule files read it: sections/appendix-sequence.ts
 * (numbering, mode, order) and appendices.ts (content). The ID shape comes from the descriptor's
 * appendix rule, the same place the appendix ID prose is built from.
 */
import type { SectionId } from '../../../contract/brands.js';
import type { Mode } from '../../../contract/ports/model.js';
import { buildSpecAppendix } from '../build-spec/descriptor.js';
import { sectionIdOf, type Declaration } from './declarations.js';

/** An appendix section parsed from its ID: `@flow-51` is mode flow, number 51. */
export type Appendix = {
  readonly section: Declaration;
  readonly id: SectionId;
  readonly number: number;
  /** The mode the ID prefix names; one of the descriptor's appendix modes. */
  readonly mode: Mode;
};

/**
 * `<prefix>-<document number>N` with N positive and no leading zero, e.g. `flow-51`. The prefix is
 * checked against the appendix modes after the match.
 */
const appendixIdShape = new RegExp(`^([a-z]+)-${buildSpecAppendix.number}([1-9][0-9]*)$`);

/** The appendix sections of a list, parsed from their IDs. */
export function collectAppendices(sections: readonly Declaration[]): Appendix[] {
  return sections.flatMap((section) => {
    const sectionId = sectionIdOf(section);
    if (sectionId === undefined) return [];
    return appendixOf(section, sectionId);
  });
}

/** The appendix of one section, or nothing when its ID does not name an appendix mode and number. */
function appendixOf(
  section: Declaration,
  sectionId: SectionId,
): Appendix[] {
  const [, prefix, digits] = appendixIdShape.exec(sectionId) ?? [];
  const mode = appendixMode(prefix);
  if (mode === undefined || digits === undefined) return [];
  return [{ section, id: sectionId, number: Number(digits), mode }];
}

/** The descriptor's appendix mode an ID prefix names, or nothing when it names none. */
function appendixMode(prefix: string | undefined): Mode | undefined {
  return buildSpecAppendix.modes.find((mode) => mode === prefix);
}
