/*
 * Movement review vocabulary. A placement gesture whose Model review offers a choice is held with
 * the diagram it was made on, and the held review is the one the view shows. The review is being
 * applied while its phase is sending or uncertain; no other flag says so. Pure; the session holds
 * one slot and publishes `shown`.
 */
import type { MoveReview } from '../../../contract/records/movement.js';
import type { PlacementIntent } from '../../../contract/records/owners.js';
import type { MovementReviewState } from '../../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../../contract/records/active-diagram.js';

/** The gesture under review: its diagram, intent, Model's review and the workspace it was made in. */
export interface MovementCapture {
  readonly active: ActiveDiagram;
  readonly intent: PlacementIntent;
  readonly review: MoveReview;
  readonly workspace: string;
}

/** A held review: the gesture it came from and the review state the view shows. */
export interface MovementHeld {
  readonly capture: MovementCapture;
  readonly shown: MovementReviewState;
}

/** No review, or the one held review. */
export type MovementSlot = MovementHeld | null;

/** Where a held review is: awaiting a choice, sending, uncertain or refused. */
export type MovementPhase = MovementReviewState['phase'];
