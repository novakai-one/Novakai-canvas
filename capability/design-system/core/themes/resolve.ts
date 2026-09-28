import type { SourceSet, ThemeDelta } from '../../contract/records/source.js';
import type { UiPreferences, Environment, UiThemePin } from '../../contract/records/preferences.js';
import type { Identity } from '../../contract/ports/identity.js';
import type { TokenValues } from '../../contract/records/tokens.js';
import type { ResolvedTokenSet } from '../../contract/records/resolved.js';
import { reject, accepted } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';
import { changedDefinitions } from './overrides.js';
import { preferenceOverrides } from './preferences.js';
import { resolveDefinitions } from '../tokens/resolve.js';
import { validateBounds } from '../tokens/bounds.js';
import { validateContrast } from '../tokens/contrast.js';
import { validateFonts } from './fonts.js';
import { emitVariables } from '../tokens/emit.js';
/** Theme identity pins definitions and policy as well as its own delta; other shipped themes do not affect it. */
export function themePin(
  source: SourceSet,
  theme: ThemeDelta,
  identity: Identity,
): UiThemePin {
  return {
    id: theme.id,
    version: theme.version,
    digest: accepted(
      identity.hash(
        canonical({
          version: source.definitionVersion,
          definitions: source.definitions,
          policy: source.policy,
          theme,
        }),
      ),
    ),
  };
}
/** Resolve UI independently of canonical diagram pins; host owns preference storage and failed-load fallback. */
export function resolveUi(
  source: SourceSet,
  preferences: UiPreferences,
  environment: Environment,
  identity: Identity,
): ResolvedTokenSet {
  const theme = selectedTheme(source, preferences, environment, identity);
  const overrides: TokenValues = {
    ...theme.overrides,
    ...preferenceOverrides(source, preferences, environment),
  };
  const resolved = resolveDefinitions(changedDefinitions(source, overrides));
  validateBounds(source, resolved.values, 'ui');
  validateFonts(source, resolved.values, [], 'ui');
  const contrast = validateContrast(source, resolved.values, source.policy.roles);
  const pin = themePin(source, theme, identity);
  const inputDigest = accepted(identity.hash(canonical({ source, preferences, environment })));
  const digest = accepted(
    identity.hash(
      canonical({
        scope: 'ui',
        values: resolved.values,
        provenance: pin,
        forcedColors: environment.forcedColors,
      }),
    ),
  );
  return {
    definitionVersion: source.definitionVersion,
    inputDigest,
    digest,
    scope: 'ui',
    values: resolved.values,
    css: emitVariables(resolved.values),
    dependencies: resolved.dependencies,
    primary: source.policy.primary,
    contrast,
    fonts: [],
    roles: source.policy.roles,
    provenance: { ui: pin, diagram: null },
    forcedColors: environment.forcedColors,
  };
}
/** System selects this release's shipped theme; explicit selection demands all three exact pin members. */
function selectedTheme(
  source: SourceSet,
  preferences: UiPreferences,
  environment: Environment,
  identity: Identity,
): ThemeDelta {
  if (preferences.theme.mode === 'system') return namedTheme(source, systemThemeId(environment));
  const expected = preferences.theme.theme;
  const theme = namedTheme(source, expected.id);
  requireUiPin(source, theme, expected, identity);
  return theme;
}
/** A missing theme is not silently replaced; host retains its stored record and chooses session recovery. */
export function namedTheme(
  source: SourceSet,
  id: string,
): ThemeDelta {
  const matches = source.themes.filter((theme) => theme.id === id);
  if (matches.length !== 1)
    return reject('stale-pin', id, 'one available theme', 'Theme missing or ambiguous');
  const theme = matches[0];
  if (!theme) return reject('stale-pin', id, 'available theme', 'Theme missing');
  return theme;
}

/** Scheme controls shipped selection only; a pinned custom theme ignores it. */
function systemThemeId(environment: Environment): string {
  if (environment.scheme === 'dark') return 'ink';
  return 'paper';
}
/** Exact pin comparison prevents source upgrades from changing an installed theme silently. */
function requireUiPin(
  source: SourceSet,
  theme: ThemeDelta,
  expected: UiThemePin,
  identity: Identity,
): void {
  const actual = themePin(source, theme, identity);
  if (canonical(actual) !== canonical(expected))
    reject('stale-pin', expected.id, 'exact available UI pin', 'UI theme pin differs');
}
