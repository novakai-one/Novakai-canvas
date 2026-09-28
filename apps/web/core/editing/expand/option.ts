/*
 * The expand entry point: prepare the dragged node, compute the container growth, then preview
 * the expansion. Each stage names its failures; a null option means nothing needed to grow.
 */
import type { PlacementIntent } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type { MoveOption, MovementPreviewContext } from '../../../contract/records/movement.js';
import { prepareExpansion } from './prepare.js';
import { computeExpansion } from './geometry.js';
import { previewExpansion } from './inspect.js';

/** Build the supported right/bottom container expansion candidate. */
export function buildExpandOption(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<MoveOption | null> {
  const prepared = prepareExpansion(intent, context);
  if (!prepared.ok) return prepared;
  const geometry = computeExpansion(prepared.value);
  if (geometry === null) return { ok: true, value: null };
  return previewExpansion(prepared.value, geometry, context);
}
