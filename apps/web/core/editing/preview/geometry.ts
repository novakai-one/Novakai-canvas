/*
 * Checking each expected box against its preview box: an allowed movement, an exact match,
 * or a mismatch failure. Pure; Authoring owns commit and recovery.
 */
import type { PlacementIntent, RenderDocument, Target } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type { GeometryChange } from '../../../contract/records/movement.js';
import { failure } from '../../../contract/errors.js';
import { exactBox, sceneBox, targetKey, type Box } from '../capture/boxes.js';
import { expectedBoxes } from '../movement-intent/expected.js';
import { collectResults } from '../results.js';
import { indexMovePreview } from './indexing.js';
import { matchesAllowedMovement } from './rules.js';
import type { GeometryPreview, PreviewBox } from './types.js';

/** The geometry changes of a preview: each expected box checked against the captured one. */
export function geometryChanges(
  document: RenderDocument,
  entries: readonly PlacementIntent['entries'][number][],
  preview: GeometryPreview,
): Result<readonly GeometryChange[]> {
  const expected = expectedBoxes(document, entries);
  if (!expected.ok) return expected;
  return inspectGeometry(document, expected.value, preview);
}

/** The preview indexed by target key; duplicates are rejected. */
function inspectGeometry(
  document: RenderDocument,
  expected: ReadonlyMap<string, Box>,
  preview: GeometryPreview,
): Result<readonly GeometryChange[]> {
  const actual = indexMovePreview(preview);
  if (!actual.ok) return actual;
  return inspectGeometryTargets(document, expected, actual.value, preview);
}

/** The preview's target set matches the captured set exactly. */
function inspectGeometryTargets(
  document: RenderDocument,
  expected: ReadonlyMap<string, Box>,
  actual: ReadonlyMap<string, PreviewBox>,
  preview: GeometryPreview,
): Result<readonly GeometryChange[]> {
  const targetSet = validateMoveTargetSet(actual, expected);
  if (!targetSet.ok) return targetSet;
  return inspectExpectedGeometry(document, expected, actual, preview);
}

/** The target sets match in size, then key by key. */
function validateMoveTargetSet(
  actual: ReadonlyMap<string, PreviewBox>,
  expected: ReadonlyMap<string, Box>,
): Result<void> {
  if (actual.size !== expected.size)
    return failure('invalid-edit', 'Movement preview contains an unexpected geometry target set');
  return expectedKeysComplete(actual, expected);
}

/** Every expected key is present in the preview. */
function expectedKeysComplete(
  actual: ReadonlyMap<string, PreviewBox>,
  expected: ReadonlyMap<string, Box>,
): Result<void> {
  const missing = [...expected.keys()].find((key) => !actual.has(key));
  if (missing !== undefined) {
    return failure('invalid-edit', 'Movement preview omitted a captured geometry target');
  }
  return { ok: true, value: undefined };
}

/** Every expected box, checked against its preview box. */
function inspectExpectedGeometry(
  document: RenderDocument,
  expected: ReadonlyMap<string, Box>,
  actual: ReadonlyMap<string, PreviewBox>,
  preview: GeometryPreview,
): Result<readonly GeometryChange[]> {
  return collectResults([...expected.entries()], ([key, before]) =>
    inspectExpectedItem(document, before, actual.get(key), preview),
  );
}

/** One expected box; its preview entry must exist. */
function inspectExpectedItem(
  document: RenderDocument,
  expected: Box,
  item: PreviewBox | undefined,
  preview: GeometryPreview,
): Result<GeometryChange | undefined> {
  if (item === undefined) {
    return failure('invalid-edit', 'Movement preview omitted a captured geometry target');
  }
  return inspectGeometryItem(document, expected, item, preview);
}

/** One box: an allowed movement, an exact match, or a mismatch failure. */
function inspectGeometryItem(
  document: RenderDocument,
  expected: Box,
  item: PreviewBox,
  preview: GeometryPreview,
): Result<GeometryChange | undefined> {
  if (matchesAllowedMovement(document, item, expected, preview)) {
    return inspectMatchedGeometry(document, item, preview);
  }
  return inspectExactGeometry(document, expected, item, preview);
}

/** Not an allowed movement: only an exact box match passes. */
function inspectExactGeometry(
  document: RenderDocument,
  expected: Box,
  item: PreviewBox,
  preview: GeometryPreview,
): Result<GeometryChange | undefined> {
  const exact = validateExpectedBox(expected, item.box);
  if (!exact.ok) return exact;
  return inspectMatchedGeometry(document, item, preview);
}

/** The requested and preview boxes match dimension for dimension. */
function validateExpectedBox(
  expected: Box,
  actual: Box,
): Result<void> {
  if (exactBox(expected, actual)) return { ok: true, value: undefined };
  return failure('invalid-edit', 'Movement preview does not match the requested geometry');
}

/** The matched preview box becomes a change when it differs from the captured one. */
function inspectMatchedGeometry(
  document: RenderDocument,
  item: PreviewBox,
  preview: GeometryPreview,
): Result<GeometryChange | undefined> {
  const matched = preview.boxes.find(
    (candidate) => targetKey(candidate.target) === targetKey(item.target),
  );
  if (matched === undefined) {
    return failure('invalid-edit', 'Movement preview omitted a captured target identity');
  }
  return inspectCapturedGeometry(document, matched.target, item.box);
}

/** A change when the preview box differs from the captured box; nothing when equal. */
function inspectCapturedGeometry(
  document: RenderDocument,
  target: Target,
  after: Box,
): Result<GeometryChange | undefined> {
  const captured = sceneBox(document, target);
  if (captured === undefined) {
    return failure('stale-target', 'Movement preview target is not captured');
  }
  if (exactBox(captured, after)) return { ok: true, value: undefined };
  return { ok: true, value: { target, before: captured, after } };
}
