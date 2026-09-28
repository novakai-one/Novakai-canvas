/*
 * The movement review binding: a placement intent becomes the review the canvas shows — the
 * plain move first, then an expand or rearrange option when the canvas offers one.
 */
import type { Change, EditIntent, RenderDocument } from '../records/owners.js';
import type { MoveReview } from '../records/movement.js';
import type { Result } from '../errors.js';
import type { WorkspaceBindings } from '../ports/workspace.js';
import { previewModuleRoutes } from '../../adapters/readers/route-preview.js';
import {
  buildExpandOption,
  buildMoveReview,
  buildRearrangeOption,
} from '../../core/editing/movement.js';

/** The review for a placement intent: the plain move, plus any expand or rearrange option. */
export function createMovementReviewBinding(
  document: RenderDocument,
  intent: Extract<EditIntent, { kind: 'placement' }>,
  stamp: Parameters<NonNullable<WorkspaceBindings['moveReview']>>[2],
): Result<MoveReview> {
  const context = {
    document,
    stamp,
    preview: (
      previewDocument: typeof document,
      previewIntent: typeof intent,
      changes: readonly Change[],
    ) => previewModuleRoutes(previewDocument, previewIntent, changes),
  };
  const move = buildMoveReview(intent, context);
  if (hasMoveOnlyOption(move)) return move;
  const expanded = buildExpandOption(intent, context);
  const rearranged = buildRearrangeOption(intent, context);
  const options = movementReviewOptions(move, expanded, rearranged);
  if (options.length === 0) return move;
  const base = movementReviewBase(move, document, intent, stamp);
  return { ok: true, value: { ...base, options, selectedOption: options[0]?.id ?? null } };
}

/** A node already at its group's edge stays there; that is an answer, not a review. */
function hasMoveOnlyOption(move: Result<MoveReview>): boolean {
  return move.ok && (move.value.options.length > 0 || move.value.reason !== undefined);
}

/** The options in display order: the plain move's own options, then expand, then rearrange. */
function movementReviewOptions(
  move: Result<MoveReview>,
  expanded: Result<MoveReview['options'][number] | null>,
  rearranged: Result<MoveReview['options'][number] | null>,
): MoveReview['options'] {
  return [
    ...(move.ok ? move.value.options : []),
    ...optionResult(expanded),
    ...optionResult(rearranged),
  ];
}

/** A present option as a one-item list; a failure or an absent option as none. */
function optionResult<T>(result: Result<T | null>): readonly T[] {
  return result.ok && result.value !== null ? [result.value] : [];
}

/** The review shell when the plain move fails: no options, nothing selected. */
function movementReviewBase(
  move: Result<MoveReview>,
  document: RenderDocument,
  intent: Extract<EditIntent, { kind: 'placement' }>,
  stamp: Parameters<NonNullable<WorkspaceBindings['moveReview']>>[2],
): MoveReview {
  if (move.ok) return move.value;
  return {
    id: intent.id,
    intent,
    stamp,
    collectionId: document.collection.id,
    revision: document.collection.revision,
    options: [],
    selectedOption: null,
  };
}
