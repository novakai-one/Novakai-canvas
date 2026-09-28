import type { Change, PlacementIntent, SceneStamp } from '../../contract/records/owners.js';
import type { Result } from '../../contract/errors.js';
import type {
  GeometryChange,
  MoveOption,
  MoveReview,
  MovementPreviewContext,
} from '../../contract/records/movement.js';
import { failure } from '../../contract/errors.js';
import { changes, plannedSections } from './capture/settling/sections.js';
import { sameStampValue, validateMoveIntent } from './movement-intent/admission.js';
import { movableEntries } from './movement-intent/selection.js';
import { geometryChanges } from './preview/geometry.js';

export { buildExpandOption } from './expand/option.js';
export { buildRearrangeOption } from './rearrange/option.js';

type GeometryPreview = MoveOption['preview'];
type PreparedMove = {
  readonly intent: PlacementIntent;
  readonly changes: readonly Change[];
};

export function buildMoveReview(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<MoveReview> {
  const prepared = prepareMove(intent, context);
  if (!prepared.ok) return prepared;
  const previewed = previewMove(prepared.value, context);
  if (!previewed.ok) return previewed;
  return inspectMove(prepared.value, context, previewed.value);
}

export function chooseMoveOption(
  review: MoveReview,
  optionId: string,
  current: SceneStamp,
): Result<MoveOption> {
  if (!sameStampValue(review.stamp, current))
    return failure('stale-gesture', 'The diagram changed while this move was under review');
  const selected = review.options.find((option) => option.id === optionId);
  if (selected === undefined)
    return failure('invalid-edit', 'That movement option is no longer available');
  return { ok: true, value: selected };
}

function prepareMove(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<PreparedMove> {
  const validation = validateMoveIntent(intent, context);
  if (!validation.ok) return validation;
  if (context.preview === undefined)
    return failure('invalid-edit', 'Movement preview is not available');
  return prepareMovePlan(intent, context);
}

function prepareMovePlan(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<PreparedMove> {
  const normalized = movableEntries(context.document, intent);
  if (!normalized.ok) return normalized;
  const preparedIntent = { ...intent, entries: normalized.value };
  const planned = plannedSections(context.document, preparedIntent);
  if (!planned.ok) return planned;
  return {
    ok: true,
    value: {
      intent: preparedIntent,
      changes: changes(context.document, planned.value),
    },
  };
}

function previewMove(
  prepared: PreparedMove,
  context: MovementPreviewContext,
): Result<GeometryPreview | null> {
  if (context.preview === undefined)
    return failure('invalid-edit', 'Movement preview is not available');
  return context.preview(context.document, prepared.intent, prepared.changes);
}

function inspectMove(
  prepared: PreparedMove,
  context: MovementPreviewContext,
  preview: GeometryPreview | null,
): Result<MoveReview> {
  if (preview === null) return failure('invalid-edit', 'Movement preview produced no geometry');
  const inspected = geometryChanges(context.document, prepared.intent.entries, preview);
  if (!inspected.ok) return inspected;
  return createMoveReview(prepared.intent, context, prepared.changes, inspected.value, preview);
}

function createMoveReview(
  intent: PlacementIntent,
  context: MovementPreviewContext,
  plannedChanges: readonly Change[],
  inspected: readonly GeometryChange[],
  preview: GeometryPreview,
): Result<MoveReview> {
  if (inspected.length === 0)
    return {
      ok: true,
      value: {
        id: intent.id,
        intent,
        stamp: context.stamp,
        collectionId: context.document.collection.id,
        revision: context.document.collection.revision,
        options: [],
        selectedOption: null,
        reason: 'The requested position produced no changed geometry.',
      },
    };
  const option: MoveOption = {
    id: 'move-only',
    kind: 'move-only',
    label: 'Move only',
    changes: plannedChanges,
    geometryChanges: inspected,
    preview,
  };
  return {
    ok: true,
    value: {
      id: intent.id,
      intent,
      stamp: context.stamp,
      collectionId: context.document.collection.id,
      revision: context.document.collection.revision,
      options: [option],
      selectedOption: option.id,
    },
  };
}
