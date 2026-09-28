import type { SourceSet } from '../../contract/records/source.js';
import type { TokenValue, TokenValues } from '../../contract/records/tokens.js';
import type { FontPin } from '../../contract/records/theme.js';
import { fontPin } from '../../contract/records/theme.js';
import { member, parsed, list } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
/** Exact admitted font metadata is checked, detached and never replaced with a platform guess. */
export function readFonts(value: unknown): readonly FontPin[] {
  return list(value, 'fonts').map((item) => parsed(fontPin, item, 'fonts'));
}
/** UI uses only approved system aliases; diagrams use exactly their supplied admitted families. */
export function validateFonts(
  source: SourceSet,
  values: TokenValues,
  fonts: readonly FontPin[],
  scope: 'ui' | 'diagram' | 'export',
): void {
  const allowed = scope === 'ui' ? source.policy.aliases : fonts.map((font) => font.family);
  Object.entries(values)
    .filter(([, value]) => value.type === 'fontFamily')
    .forEach(([id, value]) => validateFontValue(id, value, allowed));
  if (scope !== 'ui')
    ['font.body', 'font.mono', 'font.strong'].forEach((id) => requirePinnedFont(id, values, fonts));
}
/** Every family in a stack is approved; unsafe fallback members are not ignored. */
function validateFontValue(
  id: string,
  value: TokenValue,
  allowed: readonly string[],
): void {
  if (value.type !== 'fontFamily') return;
  value.value.forEach((family) => {
    if (!allowed.includes(family))
      reject('missing-font', id, 'approved family', 'Unapproved font family');
  });
}
/** Diagram fonts have exactly one family, resolved to one admitted digest. */
export function requirePinnedFont(
  id: string,
  values: TokenValues,
  fonts: readonly FontPin[],
): FontPin {
  const value = member(values, id);
  if (value.type !== 'fontFamily') return reject('missing-font', id, 'fontFamily', 'Expected font');
  if (value.value.length !== 1)
    return reject('missing-font', id, 'one exact family', 'Diagram font cannot use fallbacks');
  return uniqueFamilyPin(id, value.value[0], fonts);
}

/** Ambiguous family-to-byte identity is an admission error; no first-match substitution. */
function uniqueFamilyPin(
  id: string,
  family: string | undefined,
  fonts: readonly FontPin[],
): FontPin {
  const matches = fonts.filter((font) => font.family === family);
  if (matches.length !== 1)
    return reject('missing-font', id, 'one admitted pin', 'Font pin missing or ambiguous');
  const pin = matches[0];
  if (!pin) return reject('missing-font', id, 'font pin', 'Font pin missing');
  return pin;
}
