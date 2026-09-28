/*
 * Inspecting an expansion preview: the materialized changes go through the native preview, and
 * the option is offered only when every expected box — the dragged node, the grown groups and
 * the grown section — comes back exactly as computed, with at least one real movement.
 */
import type { Change, RenderDocument, Target } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type { MoveOption, MovementPreviewContext } from '../../../contract/records/movement.js';
import { failure } from '../../../contract/errors.js';
import { exactBox, sceneBox, targetKey, type Box } from '../capture/boxes.js';
import { expectedBoxes } from '../movement-intent/expected.js';
import { materializeExpansion } from './materialize.js';
import type {
  ExpandedGroup,
  ExpansionGeometry,
  ExpansionInspection,
  ExpansionPreparation,
  MaterializedExpansion,
} from './types.js';

/** Materialize the expansion, then verify it through the native preview. */
export function previewExpansion(
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const materialized = materializeExpansion(prepared, geometry, context.document);
  return materialized.ok
    ? previewExpansionChanges(prepared, geometry, materialized.value, context)
    : materialized;
}

/** The native preview must exist before the materialized changes can be verified. */
function previewExpansionChanges(
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  materialized: MaterializedExpansion,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const preview = context.preview;
  return preview === undefined
    ? failure('invalid-edit', 'Movement preview is not available')
    : callExpansionPreview(prepared, geometry, materialized.changes, context, preview);
}

/** Run the native preview over the expansion changes; a null result refuses the option. */
function callExpansionPreview(
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  changes: readonly Change[],
  context: MovementPreviewContext,
  preview: NonNullable<MovementPreviewContext['preview']>,
): Result<MoveOption | null> {
  const result = preview(context.document, prepared.intent, changes);
  if (!result.ok) return result;
  if (result.value === null)
    return failure('invalid-edit', 'Native movement preview produced no geometry');
  return inspectExpansion(prepared, geometry, changes, result.value, context.document);
}

/** Compute the expected boxes before checking them against the preview. */
function inspectExpansion(
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  plannedChanges: readonly Change[],
  preview: MoveOption['preview'],
  document: RenderDocument,
): Result<MoveOption | null> {
  const expected = expectedBoxes(document, prepared.intent.entries);
  return expected.ok
    ? inspectExpansionExpectations(
        prepared,
        geometry,
        expected.value,
        document,
        preview,
        plannedChanges,
      )
    : expected;
}

/** Extend the expected boxes with the grown section and every grown group. */
function inspectExpansionExpectations(
  prepared: ExpansionPreparation,
  geometry: ExpansionGeometry,
  expected: ReadonlyMap<string, Box>,
  document: RenderDocument,
  preview: MoveOption['preview'],
  plannedChanges: readonly Change[],
): Result<MoveOption | null> {
  const expectedWithExpansion = new Map(expected);
  expectedWithExpansion.set(targetKey({ kind: 'section', id: prepared.sceneSection.id }), {
    ...prepared.sceneSection.box,
    width: geometry.sectionWidth,
    height: geometry.sectionHeight,
  });
  const additions = [...geometry.expanded.values()].map((change) =>
    addExpansionExpectation(expectedWithExpansion, document, prepared.sceneSection.id, change),
  );
  const invalid = additions.find((result) => !result.ok || !result.value);
  return finishExpansionExpectations(
    invalid,
    expectedWithExpansion,
    preview,
    plannedChanges,
    prepared.sceneSection.id,
    document,
  );
}

/** A group whose prior box is missing declines the option; a failure propagates. */
function finishExpansionExpectations(
  invalid: Result<boolean> | undefined,
  expected: ReadonlyMap<string, Box>,
  preview: MoveOption['preview'],
  plannedChanges: readonly Change[],
  sectionId: string,
  document: RenderDocument,
): Result<MoveOption | null> {
  if (invalid === undefined)
    return inspectExpansionGeometry(document, expected, preview, plannedChanges, sectionId);
  return invalid.ok ? { ok: true, value: null } : invalid;
}

/** Expect one grown group's new size at its prior position. */
function addExpansionExpectation(
  expected: Map<string, Box>,
  document: RenderDocument,
  sectionId: string,
  change: ExpandedGroup,
): Result<boolean> {
  const target: Target = { kind: 'node', section: sectionId, id: change.node.id };
  const prior = sceneBox(document, target);
  if (prior === undefined) return { ok: true, value: false };
  expected.set(targetKey(target), { ...prior, width: change.width, height: change.height });
  return { ok: true, value: true };
}

/** The preview must cover exactly the expected targets, each at most once. */
function inspectExpansionGeometry(
  document: RenderDocument,
  expected: ReadonlyMap<string, Box>,
  preview: MoveOption['preview'],
  plannedChanges: readonly Change[],
  sectionId: string,
): Result<MoveOption | null> {
  const actual = indexExpansionPreview(preview);
  if (actual === null || actual.size !== expected.size) return { ok: true, value: null };
  return inspectExpansionBoxes(document, expected, actual, preview, plannedChanges, sectionId);
}

/** Index the preview boxes by target key; a duplicated target means the preview is unusable. */
function indexExpansionPreview(preview: MoveOption['preview']): ReadonlyMap<string, Box> | null {
  const keys = preview.boxes.map((item) => targetKey(item.target));
  return new Set(keys).size === keys.length ? indexPreviewBoxes(preview) : null;
}

/** The preview boxes indexed by target key; the caller has checked the keys are unique. */
function indexPreviewBoxes(preview: MoveOption['preview']): ReadonlyMap<string, Box> {
  return new Map(preview.boxes.map((item) => [targetKey(item.target), item.box] as const));
}

/** Check every expected box against the preview, then offer or decline the option. */
function inspectExpansionBoxes(
  document: RenderDocument,
  expected: ReadonlyMap<string, Box>,
  actual: ReadonlyMap<string, Box>,
  preview: MoveOption['preview'],
  plannedChanges: readonly Change[],
  sectionId: string,
): Result<MoveOption | null> {
  const inspections = [...expected.entries()].map(([key, expectedBox]) =>
    inspectExpansionBox(document, key, expectedBox, actual, preview),
  );
  return acceptExpansionInspections(inspections, plannedChanges, preview, sectionId);
}

/** Offer the option when every box matched and at least one target actually moved. */
function acceptExpansionInspections(
  inspections: readonly ExpansionInspection[],
  plannedChanges: readonly Change[],
  preview: MoveOption['preview'],
  sectionId: string,
): Result<MoveOption | null> {
  if (inspections.some((inspection) => !inspection.valid)) return { ok: true, value: null };
  const geometryChanges = inspections.flatMap((inspection) =>
    inspection.change === null ? [] : [inspection.change],
  );
  return geometryChanges.length === 0
    ? { ok: true, value: null }
    : {
        ok: true,
        value: {
          id: 'expand-container',
          kind: 'expand',
          label: 'Expand container',
          section: sectionId,
          changes: plannedChanges,
          geometryChanges,
          preview,
        },
      };
}

/** One expected box: valid when the preview reproduced it exactly and its target still exists. */
function inspectExpansionBox(
  document: RenderDocument,
  key: string,
  expected: Box,
  actual: ReadonlyMap<string, Box>,
  preview: MoveOption['preview'],
): ExpansionInspection {
  const checked = checkedExpansionItem(actual.get(key), preview, key, expected);
  if (checked === undefined) return { valid: false, change: null };
  const prior = sceneBox(document, checked.item.target);
  if (prior === undefined) return { valid: false, change: null };
  return expansionDelta(prior, checked.item.target, checked.after);
}

/** The preview item for a key, when it exists and matches the expected box exactly. */
function checkedExpansionItem(
  after: Box | undefined,
  preview: MoveOption['preview'],
  key: string,
  expected: Box,
):
  | { readonly after: Box; readonly item: { readonly target: Target; readonly box: Box } }
  | undefined {
  const item = preview.boxes.find((candidate) => targetKey(candidate.target) === key);
  return after !== undefined && item !== undefined && exactBox(after, expected)
    ? { after, item }
    : undefined;
}

/** An unchanged box is valid and contributes no movement; a moved one does. */
function expansionDelta(
  prior: Box,
  target: Target,
  after: Box,
): ExpansionInspection {
  return exactBox(prior, after)
    ? { valid: true, change: null }
    : { valid: true, change: { target, before: prior, after } };
}
