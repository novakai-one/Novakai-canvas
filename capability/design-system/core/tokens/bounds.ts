import type { SourceSet } from '../../contract/records/source.js';
import type { TokenValues } from '../../contract/records/tokens.js';
import { member } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
import { numeric } from './values.js';
/** Frozen authored ranges are applied after preference/delta composition; facade owns correction. */
export function validateBounds(
  source: SourceSet,
  values: TokenValues,
  scope: 'ui' | 'diagram' | 'export',
): void {
  Object.entries(source.policy.bounds).forEach(([id, bound]) => {
    const value = numeric(member(values, id), id);
    const min = scope === 'ui' ? bound.min : bound.diagramMin;
    const max = scope === 'ui' ? bound.max : bound.diagramMax;
    checkRange(id, value, min, max);
  });
}
/** Inclusive bounds reject NaN/overflow earlier in decoding, then precise named range violations here. */
function checkRange(
  id: string,
  value: number,
  min: number,
  max: number,
): void {
  if (value < min || value > max)
    reject('out-of-range', id, String(min) + '..' + String(max), 'Token outside allowed range');
}
