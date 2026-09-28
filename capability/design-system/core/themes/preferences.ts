import { tokenId } from '../../contract/brands.js';
import type { UiPreferences, Environment } from '../../contract/records/preferences.js';
import type { SourceSet } from '../../contract/records/source.js';
import type { TokenValue, TokenValues } from '../../contract/records/tokens.js';
import { member } from '../validation/input.js';
/** Apply exactly the four preference fields; accessibility floors are final and cannot be disabled. */
export function preferenceOverrides(
  source: SourceSet,
  preferences: UiPreferences,
  environment: Environment,
): TokenValues {
  const density = source.policy.densities[preferences.density];
  const target = environment.pointer === 'coarse' ? 'target.coarse' : 'target.fine';
  const roots = Object.fromEntries(source.definitions.map((item) => [item.id, item]));
  const floor = member(roots, target);
  const active = floor.expression.op === 'literal' ? floor.expression.value : null;
  return {
    ...activeTarget(active),
    ...motionOverrides(preferences, environment),
    [tokenId.parse('type.base')]: { type: 'dimension', value: preferences.textSize, unit: 'px' },
    [tokenId.parse('space.unit')]: { type: 'dimension', value: density.space, unit: 'px' },
    [tokenId.parse('control.unit')]: { type: 'dimension', value: density.control, unit: 'px' },
  };
}
/** A supported target floor must remain a source literal; malformed sources fail at resolution. */
function activeTarget(value: TokenValue | null): TokenValues {
  if (value === null) return {};
  return { [tokenId.parse('target.active')]: value };
}
/** Full preference still respects the OS reduction request. */
function motionOverrides(
  preferences: UiPreferences,
  environment: Environment,
): TokenValues {
  if (preferences.motion === 'reduced' || environment.reducedMotion)
    return {
      [tokenId.parse('motion.duration')]: { type: 'duration', value: 0, unit: 'ms' },
      [tokenId.parse('camera.duration')]: { type: 'duration', value: 0, unit: 'ms' },
    };
  return {};
}
