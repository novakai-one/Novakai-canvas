/*
 * Appendix sections read from their IDs: `@flow-51` is a flow appendix numbered 51. Pure. Owns the
 * `Appendix` type. Its own file because two rule files read it: sections/appendix-sequence.ts
 * (numbering, mode, order) and appendices.ts (content). The allowed modes come from the
 * descriptor's appendix rule; this file only knows the `<prefix>-5N` shape.
 */
import type { Mode } from '../../../contract/records/foreign.js';
import { buildSpecProfile } from '../build-spec/descriptor.js';
import { id, type Declaration } from './declarations.js';

/** An appendix section parsed from its id: `@flow-51` is mode flow, number 51. */
export type Appendix = {
  readonly section: Declaration;
  readonly id: string;
  readonly number: number;
  /** The mode the ID prefix names; one of the descriptor's appendix modes. */
  readonly mode: Mode;
};

/** `<prefix>-5N` with N positive and no leading zero; the prefix is checked against the modes. */
const appendixIdShape = /^([a-z]+)-5([1-9][0-9]*)$/;

/** The appendix sections of a list, parsed from their ids. */
export function collectAppendices(sections: readonly Declaration[]): Appendix[] {
  return sections.flatMap((section) => {
    const sectionId = id(section);
    return sectionId === undefined ? [] : appendixOf(section, sectionId);
  });
}

/** The appendix of one section, or nothing when its id does not name an appendix mode and number. */
function appendixOf(
  section: Declaration,
  sectionId: string,
): Appendix[] {
  const [, prefix, digits] = appendixIdShape.exec(sectionId) ?? [];
  const mode = appendixMode(prefix);
  if (mode === undefined || digits === undefined) return [];
  return [{ section, id: sectionId, number: Number(digits), mode }];
}

/** The descriptor's appendix mode an ID prefix names, or nothing when it names none. */
function appendixMode(prefix: string | undefined): Mode | undefined {
  return buildSpecProfile.appendix.modes.find((mode) => mode === prefix);
}
