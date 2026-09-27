/*
 * What a placement gesture's Model review asks for. A review is asked for only when no entry is
 * resized and some entry sits in a modules diagram. A review with no options but a reason changed
 * nothing, so the gesture is discarded; an expand or rearrange option is held for the human to
 * choose; a single plain option is sent at once; anything else is refused. Pure; the session
 * dispatches, holds and sends.
 */
import type { Diagnostic } from '../../../contract/errors.js';
import type { MoveOption, MoveReview } from '../../../contract/records/movement.js';
import type { PlacementIntent, RenderDocument, Target } from '../../../contract/records/owners.js';
import { noMoveOnlyOption } from './failures.js';

/** Discard the gesture, hold a review for this option, send this option, or refuse. */
export type ReviewOutcome =
  | { readonly kind: 'discard' }
  | { readonly kind: 'retain'; readonly option: MoveOption }
  | { readonly kind: 'submit'; readonly option: MoveOption }
  | { readonly kind: 'reject'; readonly error: Diagnostic };

/** Model reviews this gesture: nothing is resized and some entry sits in a modules diagram. */
export function reviewableMovement(
  document: RenderDocument,
  intent: PlacementIntent,
): boolean {
  if (intent.entries.some(resized)) return false;
  return intent.entries.some((entry) => inModules(document, entrySection(entry.target)));
}

/** What the review asks for, checked in this order: nothing moved, a choice, one plain option. */
export function reviewOutcome(review: MoveReview): ReviewOutcome {
  if (review.options.length === 0 && review.reason !== undefined) return { kind: 'discard' };
  return choiceOrOnly(review);
}

/** The entry sets a width or a height. */
function resized(entry: PlacementIntent['entries'][number]): boolean {
  return entry.placement.width !== undefined || entry.placement.height !== undefined;
}

/** The section a target sits in; null for wires and sequence steps. */
function entrySection(target: Target): string | null {
  if (target.kind === 'section') return target.id;
  return target.kind === 'node' ? target.section : null;
}

/** The section is shown as a modules diagram. */
function inModules(
  document: RenderDocument,
  section: string | null,
): boolean {
  return document.projection.sections.some(
    (item) => item.id === section && item.mode === 'modules',
  );
}

/** An expand or rearrange option is held for choice; otherwise the one plain option is sent. */
function choiceOrOnly(review: MoveReview): ReviewOutcome {
  const option = review.options.find((item) => item.kind === 'expand' || item.kind === 'rearrange');
  if (option !== undefined) return { kind: 'retain', option };
  return onlyOption(review);
}

/** Exactly one option is sent; none or several are refused. */
function onlyOption(review: MoveReview): ReviewOutcome {
  const [only] = review.options;
  if (review.options.length !== 1 || only === undefined)
    return { kind: 'reject', error: noMoveOnlyOption(review) };
  return { kind: 'submit', option: only };
}
