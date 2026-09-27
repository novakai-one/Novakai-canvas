/*
 * Accepting a materialized rearrangement: the materialized changes go through the native preview a
 * second time, and the option is offered only when the second preview matches the first box for
 * box and every first-preview target still satisfies the section and closure predicates. Pure; a
 * missing preview is an `invalid-edit` failure, never a throw. Authoring owns commit and recovery.
 */
import type { Result } from '../../../contract/errors.js';
import type { MoveOption } from '../../../contract/records/movement.js';
import { failure } from '../../../contract/errors.js';
import { exactBox, targetKey, type Box } from '../capture/boxes.js';
import { completePreview } from '../preview/completeness.js';
import { closureGeometryMatches, otherSectionMatches } from './matching.js';
import type { MaterializedPreview } from './types.js';

/**
 * Run the native preview over the materialized changes for verification.
 *
 * A missing preview is `invalid-edit`; a failed second preview returns its failure; a null
 * second preview, a geometry mismatch or a target that no longer matches declines the option.
 */
export function previewMaterializedRearrangement(
  input: MaterializedPreview,
): Result<MoveOption | null> {
  const preview = input.context.preview;
  return preview === undefined
    ? failure('invalid-edit', 'Movement preview is not available')
    : callMaterializedPreview(input, preview);
}

/** A failed second preview is a failure; a null one declines the option. */
function callMaterializedPreview(
  input: MaterializedPreview,
  preview: NonNullable<MaterializedPreview['context']['preview']>,
): Result<MoveOption | null> {
  const second = preview(input.context.document, input.prepared.intent, input.finalChanges);
  return second.ok ? inspectMaterializedPreview(input, second.value) : second;
}

/** Flatten the second preview before comparing it with the first. */
function inspectMaterializedPreview(
  input: MaterializedPreview,
  secondPreview: MoveOption['preview'] | null,
): Result<MoveOption | null> {
  if (secondPreview === null) return { ok: true, value: null };
  const secondMapResult = completePreview(input.context.document, secondPreview);
  return secondMapResult.ok
    ? acceptRearrangement(input, secondPreview, secondMapResult.value)
    : secondMapResult;
}

/** Offer the option only when both previews agree and every target still matches. */
function acceptRearrangement(
  input: MaterializedPreview,
  secondPreview: MoveOption['preview'],
  secondMap: ReadonlyMap<string, Box>,
): Result<MoveOption | null> {
  if (!sameGeometryMap(input.firstMap, secondMap)) return { ok: true, value: null };
  const accepted = inspectSecondTargets(input);
  if (!accepted) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      id: 'rearrange-section',
      kind: 'rearrange',
      label: 'Rearrange section',
      section: input.prepared.sectionId,
      changes: input.finalChanges,
      geometryChanges: input.geometryChanges,
      preview: secondPreview,
    },
  };
}

/** Every first-preview target must still satisfy the section and closure predicates. */
function inspectSecondTargets(input: MaterializedPreview): boolean {
  return [...input.firstMap].every(([key, firstBox]) => inspectSecondTarget(input, key, firstBox));
}

/** Two geometry maps agree when every shared key holds an exactly equal box. */
function sameGeometryMap(
  first: ReadonlyMap<string, Box>,
  second: ReadonlyMap<string, Box>,
): boolean {
  return [...first].every(([key, box]) => {
    const counterpart = second.get(key);
    return counterpart !== undefined && exactBox(counterpart, box);
  });
}

/** One second-preview target passes when its section and closure geometry still match. */
function inspectSecondTarget(
  input: MaterializedPreview,
  key: string,
  firstBox: Box,
): boolean {
  const target = input.firstPreview.boxes.find((item) => targetKey(item.target) === key)?.target;
  return (
    target !== undefined &&
    otherSectionMatches(input.prepared, target, firstBox, input.context.document) &&
    closureGeometryMatches(
      input.prepared,
      target,
      firstBox,
      input.expected,
      input.closure,
      input.wanted,
    )
  );
}
