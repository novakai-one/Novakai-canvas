/*
 * Appendix sections read from their IDs: `@flow-51` is a flow appendix numbered 51. Pure; read by
 * the appendix sequence and appendix content rules.
 */
import { id, type Declaration } from './declarations.js';

/** An appendix section parsed from its id: `@flow-51` is mode flow, number 51. */
export type Appendix = {
  readonly section: Declaration;
  readonly id: string;
  readonly number: number;
  readonly mode: string;
};

const appendixPattern = /^(flow|sequence|state)-5([1-9][0-9]*)$/;

/** The appendix sections of a list, parsed from their ids. */
export function collectAppendices(sections: readonly Declaration[]): Appendix[] {
  return sections.flatMap((section) => {
    const sectionId = id(section);
    return sectionId === undefined ? [] : appendixOf(section, sectionId);
  });
}

/** The appendix of one section, or nothing when its id is not an appendix id. */
function appendixOf(
  section: Declaration,
  sectionId: string,
): Appendix[] {
  const match = appendixPattern.exec(sectionId);
  return match === null
    ? []
    : [{ section, id: sectionId, number: Number(match[2]), mode: match[1] ?? '' }];
}
