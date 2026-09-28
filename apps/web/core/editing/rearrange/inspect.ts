/*
 * Inspecting the native reflow of a released section: the first preview is accepted only when the
 * section origin holds, other sections keep their captured geometry, and the selected closure
 * lands on the expected boxes. Only a reflow that moves something unselected is materialized.
 */
import type { RenderDocument, Section, Target } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type {
  GeometryChange,
  MoveOption,
  MovementPreviewContext,
} from '../../../contract/records/movement.js';
import { failure } from '../../../contract/errors.js';
import { closureKeys, exactBox, sceneBox, targetKey, type Box } from '../capture/boxes.js';
import { parentNode } from '../capture/scene.js';
import { completePreview } from '../preview/completeness.js';
import { expectedBoxes } from '../movement-intent/expected.js';
import { materializeRearrangement } from './materialize.js';
import { closureGeometryMatches, otherSectionMatches } from './matching.js';
import type { RearrangementPreparation, ReleasedCandidate, ReleasedInspection } from './types.js';

/** Preview the released candidate; inspect the reflow before offering an option. */
export function previewReleasedRearrangement(
  prepared: RearrangementPreparation,
  released: ReleasedCandidate,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const preview = context.preview;
  return preview === undefined
    ? failure('invalid-edit', 'Movement preview is not available')
    : callReleasedPreview(prepared, released, context, preview);
}

/** Run the native preview over the released changes; a null result refuses the option. */
function callReleasedPreview(
  prepared: RearrangementPreparation,
  released: ReleasedCandidate,
  context: MovementPreviewContext,
  preview: NonNullable<MovementPreviewContext['preview']>,
): Result<MoveOption | null> {
  const first = preview(context.document, prepared.intent, released.changes);
  if (!first.ok) return first;
  if (first.value === null)
    return failure('invalid-edit', 'Native rearrangement preview produced no geometry');
  return inspectReleasedRearrangement(prepared, released.sections, first.value, context);
}

/** Compute the expected closure boxes before completing the first preview. */
function inspectReleasedRearrangement(
  prepared: RearrangementPreparation,
  candidate: readonly Section[],
  firstPreview: MoveOption['preview'],
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const expected = expectedBoxes(context.document, prepared.intent.entries);
  return expected.ok
    ? completeReleasedPreview(prepared, candidate, firstPreview, expected.value, context)
    : expected;
}

/** Flatten the first preview into a geometry map before inspecting its targets. */
function completeReleasedPreview(
  prepared: RearrangementPreparation,
  candidate: readonly Section[],
  firstPreview: MoveOption['preview'],
  expected: ReadonlyMap<string, Box>,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const firstMapResult = completePreview(context.document, firstPreview);
  return firstMapResult.ok
    ? inspectReleasedTargetsAndMaterialize(
        prepared,
        candidate,
        firstPreview,
        firstMapResult.value,
        expected,
        context,
      )
    : firstMapResult;
}

/** Capture the target's before-geometry, then inspect the reflowed target set. */
function inspectReleasedTargetsAndMaterialize(
  prepared: RearrangementPreparation,
  candidate: readonly Section[],
  firstPreview: MoveOption['preview'],
  firstMap: ReadonlyMap<string, Box>,
  expected: ReadonlyMap<string, Box>,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const selectedBefore = sceneBox(context.document, prepared.entry.target);
  return selectedBefore === undefined
    ? failure('stale-target', 'The rearrangement target geometry is missing')
    : inspectReleasedTargetSet({
        prepared,
        candidate,
        firstPreview,
        firstMap,
        expected,
        closure: closureKeys(context.document, prepared.entry),
        wanted: wantedBox(prepared, selectedBefore),
        context,
      });
}

/** Check the reflowed targets, then finish by materializing or declining. */
function inspectReleasedTargetSet(input: ReleasedInspection): Result<MoveOption | null> {
  const targetCheck = inspectReleasedTargets(input);
  return targetCheck.ok ? finishReleasedTargetSet(input, targetCheck.value) : targetCheck;
}

/** Materialize only a valid reflow that moves at least one unselected node of the section. */
function finishReleasedTargetSet(
  input: ReleasedInspection,
  targetsValid: boolean,
): Result<MoveOption | null> {
  if (!targetsValid) return { ok: true, value: null };
  const geometryChanges = geometryDelta(input.context.document, input.firstPreview);
  return hasUnselectedChange(input.prepared, geometryChanges)
    ? materializeRearrangement({ ...input, geometryChanges })
    : { ok: true, value: null };
}

/** True when the reflow moves a node of the rearranged section other than the selected one. */
function hasUnselectedChange(
  prepared: RearrangementPreparation,
  geometryChanges: readonly GeometryChange[],
): boolean {
  const selectedKey = targetKey(prepared.entry.target);
  return geometryChanges.some(
    (change) =>
      targetKey(change.target) !== selectedKey &&
      ('section' in change.target ? change.target.section === prepared.sectionId : false),
  );
}

/** The box the selected node asked for: intent position relative to its parent's origin. */
function wantedBox(
  prepared: RearrangementPreparation,
  selectedBefore: Box,
): Box {
  const parent = parentNode(prepared.scene, prepared.selected);
  const parentOrigin =
    parent === undefined
      ? { x: prepared.scene.origin.x, y: prepared.scene.origin.y }
      : { x: prepared.scene.origin.x + parent.box.x, y: prepared.scene.origin.y + parent.box.y };
  return {
    ...selectedBefore,
    x: parentOrigin.x + prepared.entry.placement.x,
    y: parentOrigin.y + prepared.entry.placement.y,
  };
}

/** Every reflowed target must satisfy the geometry predicates; the first failure wins. */
function inspectReleasedTargets(input: ReleasedInspection): Result<boolean> {
  const results = [...input.firstMap].map(([key, actual]) =>
    inspectReleasedTargetEntry(input, key, actual),
  );
  const rejected = results.find((result) => !result.ok || !result.value);
  return rejected === undefined ? { ok: true, value: true } : rejected;
}

/** Resolve a geometry-map key back to its preview target before inspecting it. */
function inspectReleasedTargetEntry(
  input: ReleasedInspection,
  key: string,
  actual: Box,
): Result<boolean> {
  const target = input.firstPreview.boxes.find((item) => targetKey(item.target) === key)?.target;
  return target === undefined
    ? failure('invalid-edit', 'Movement preview target identity is missing')
    : inspectReleasedTarget(input, target, actual);
}

/** One target passes when its origin, section and closure geometry all match. */
function inspectReleasedTarget(
  input: ReleasedInspection,
  target: Target,
  actual: Box,
): Result<boolean> {
  return {
    ok: true,
    value:
      sectionOriginMatches(input.prepared, target, actual) &&
      otherSectionMatches(input.prepared, target, actual, input.context.document) &&
      closureGeometryMatches(
        input.prepared,
        target,
        actual,
        input.expected,
        input.closure,
        input.wanted,
      ),
  };
}

/** The rearranged section itself must not drift from its origin. */
function sectionOriginMatches(
  prepared: RearrangementPreparation,
  target: Target,
  actual: Box,
): boolean {
  return (
    target.kind !== 'section' ||
    target.id !== prepared.sectionId ||
    (actual.x === prepared.scene.box.x && actual.y === prepared.scene.box.y)
  );
}

/** The boxes the reflow actually moved: before and after for every changed target. */
function geometryDelta(
  document: RenderDocument,
  preview: MoveOption['preview'],
): readonly GeometryChange[] {
  return preview.boxes.flatMap((item) => {
    const before = sceneBox(document, item.target);
    return before !== undefined && !exactBox(before, item.box)
      ? [{ target: item.target, before, after: item.box }]
      : [];
  });
}
