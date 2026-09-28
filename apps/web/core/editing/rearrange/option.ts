/*
 * The rearrange entry point: prepare the target, release the section, then preview the reflow.
 * Each stage names its failures; a null option means the reflow did not qualify.
 */
import type { PlacementIntent } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type { MoveOption, MovementPreviewContext } from '../../../contract/records/movement.js';
import { prepareRearrangement } from './prepare.js';
import { releaseRearrangement } from './release.js';
import { previewReleasedRearrangement } from './inspect.js';

/** Build a deliberate release/reflow candidate for one module section. */
export function buildRearrangeOption(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const prepared = prepareRearrangement(intent, context);
  if (!prepared.ok) return prepared;
  const released = releaseRearrangement(prepared.value, context.document);
  if (!released.ok) return released;
  return previewReleasedRearrangement(prepared.value, released.value, context);
}
