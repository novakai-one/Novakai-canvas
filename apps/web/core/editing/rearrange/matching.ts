/*
 * The geometry predicates a native reflow must satisfy: the section origin holds, other sections
 * are untouched, and the selected closure lands on the expected boxes. Pure predicates shared by
 * the first and the second preview inspections.
 */
import type { RenderDocument, Target } from '../../../contract/records/owners.js';
import { exactBox, sceneBox, targetKey, type Box } from '../capture/boxes.js';
import type { RearrangementPreparation } from './types.js';

/** A target outside the rearranged section must keep its captured geometry. */
export function otherSectionMatches(
  prepared: RearrangementPreparation,
  target: Target,
  actual: Box,
  document: RenderDocument,
): boolean {
  const targetSection = targetSectionId(target);
  return (
    targetSection === null ||
    targetSection === prepared.sectionId ||
    matchesCaptured(document, target, actual)
  );
}

/** A closure target must land on its expected box; anything else is free to move. */
export function closureGeometryMatches(
  prepared: RearrangementPreparation,
  target: Target,
  actual: Box,
  expected: ReadonlyMap<string, Box>,
  closure: ReadonlySet<string>,
  wanted: Box,
): boolean {
  const key = targetKey(target);
  if (!closure.has(key)) return true;
  return matchesExpectedClosure(prepared, key, actual, expected, wanted);
}

/** The section a target belongs to, when it belongs to one. */
function targetSectionId(target: Target): string | null {
  if (target.kind === 'section') return target.id;
  return target.kind === 'node' ? target.section : null;
}

/** The reflowed box equals the box captured before the gesture. */
function matchesCaptured(
  document: RenderDocument,
  target: Target,
  actual: Box,
): boolean {
  const captured = sceneBox(document, target);
  return captured !== undefined && exactBox(captured, actual);
}

/** The closure box equals the wanted box for the selected node, else the expected one. */
function matchesExpectedClosure(
  prepared: RearrangementPreparation,
  key: string,
  actual: Box,
  expected: ReadonlyMap<string, Box>,
  wanted: Box,
): boolean {
  const expectedBox = key === targetKey(prepared.entry.target) ? wanted : expected.get(key);
  return expectedBox !== undefined && exactBox(expectedBox, actual);
}
