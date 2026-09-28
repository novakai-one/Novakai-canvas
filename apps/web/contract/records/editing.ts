/*
 * Canvas edit planning vocabulary: the rendered document and scene stamp an intent was made
 * against, and the planner that turns an intent into Model changes. Declarations only; nothing to
 * recover.
 */
import type { RenderDocument, SceneStamp, EditIntent, Change } from './owners.js';
import type { Result } from '../errors.js';
/** Canvas generation identifies the exact gesture base in addition to the document revision and layout input key. */
export interface EditContext {
  readonly document: RenderDocument;
  readonly stamp: SceneStamp;
}
/** Turns a Canvas edit intent into Model changes against the context it was made in. */
export interface EditPlanner {
  plan(
    intent: EditIntent,
    context: EditContext,
  ): Result<readonly Change[]>;
}
