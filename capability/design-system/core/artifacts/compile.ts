import type { SourceSet } from '../../contract/records/source.js';
import type { Identity } from '../../contract/ports/identity.js';
import type { ArtifactSet } from '../../contract/records/artifacts.js';
import type { UiPreferences, Environment } from '../../contract/records/preferences.js';
import { resolveUi, themePin } from '../themes/resolve.js';
import { cssName } from '../tokens/emit.js';
import { accepted } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';
import { resolveDefinitions } from '../tokens/resolve.js';
import { member } from '../validation/input.js';
import { numeric } from '../tokens/values.js';
/** Deterministic source compilation emits one immutable multi-file generation; publisher owns crash recovery. */
export function compileArtifacts(
  source: SourceSet,
  identity: Identity,
): ArtifactSet {
  const files = generatedFiles(source, identity).map(([path, content]) => ({
    path,
    content,
    hash: accepted(identity.hash(content)),
  }));
  const digest = accepted(
    identity.hash(
      canonical({
        version: source.definitionVersion,
        files: files.map((file) => ({ path: file.path, hash: file.hash })),
      }),
    ),
  );
  const manifest = {
    generation: digest,
    version: source.definitionVersion,
    files: files.map((file) => ({ path: file.path, hash: file.hash })),
  };
  return { digest, version: source.definitionVersion, files, manifest };
}
/** The output filenames are closed; no user-controlled path reaches the writer. */
function generatedFiles(
  source: SourceSet,
  identity: Identity,
): readonly (readonly [string, string])[] {
  const paper = resolveProfile(source, 'paper', 'comfortable', false, identity);
  const literals = new Set(
    source.definitions
      .filter((item) => item.expression.op === 'literal')
      .map((item) => cssName(item.id)),
  );
  const base = Object.fromEntries(Object.entries(paper).filter(([id]) => literals.has(id)));
  const semantics = Object.fromEntries(Object.entries(paper).filter(([id]) => !literals.has(id)));
  return [
    ['adapters/styles/tokens.generated.css', layer('tokens', rule('[data-nv-scope="ui"]', base))],
    [
      'adapters/styles/semantics.generated.css',
      layer('tokens', rule('[data-nv-scope="ui"]', semantics)),
    ],
    ['adapters/styles/themes.generated.css', themeStyles(source, identity)],
    ['adapters/styles/preferences.generated.css', preferenceStyles(source, identity)],
    ['adapters/styles/layout.generated.css', layoutStyles(source)],
    ['contract/generated/token-names.ts', tokenNames(source)],
    ['contract/generated/breakpoints.ts', breakpoints(source)],
  ];
}
/** Each generated theme root gets complete values; aliases cannot remain resolved against a parent theme. */
function themeStyles(
  source: SourceSet,
  identity: Identity,
): string {
  return layer(
    'themes',
    source.themes
      .map((theme) =>
        rule(
          '[data-nv-scope="ui"][data-nv-theme="' + theme.id + '"]',
          resolveProfile(source, theme.id, 'comfortable', false, identity),
        ),
      )
      .join('\n'),
  );
}
/** Shipped density/reduced-motion profiles are complete; arbitrary text-size preferences use the installer. */
function preferenceStyles(
  source: SourceSet,
  identity: Identity,
): string {
  return layer(
    'preferences',
    source.themes
      .flatMap((theme) =>
        Object.keys(source.policy.densities).flatMap((density) =>
          [false, true].map((reduced) => profileRule(source, theme.id, density, reduced, identity)),
        ),
      )
      .join('\n'),
  );
}
/** The checked density union prevents compiler-owned selectors from accepting arbitrary source text. */
function profileRule(
  source: SourceSet,
  id: string,
  density: string,
  reduced: boolean,
  identity: Identity,
): string {
  const selected = densityName(density);
  const selector =
    '[data-nv-scope="ui"][data-nv-theme="' +
    id +
    '"][data-nv-density="' +
    selected +
    '"][data-nv-reduced-motion="' +
    reduced +
    '"]';
  return rule(selector, resolveProfile(source, id, selected, reduced, identity));
}
/** Enumerated source policy keys are the public density vocabulary. */
function densityName(value: string): UiPreferences['density'] {
  if (value === 'compact') return value;
  if (value === 'spacious') return value;
  return 'comfortable';
}
/** Build and runtime use the same UI resolver; no formula is reproduced in generated CSS. */
function resolveProfile(
  source: SourceSet,
  id: string,
  density: UiPreferences['density'],
  reducedMotion: boolean,
  identity: Identity,
): Readonly<Record<string, string>> {
  const theme = source.themes.find((theme) => theme.id === id);
  const selected = member(Object.fromEntries(source.themes.map((theme) => [theme.id, theme])), id);
  const pin = themePin(source, selected, identity);
  const values = resolveDefinitions(source.definitions).values;
  const preferences: UiPreferences = {
    schemaVersion: 1,
    theme: { mode: 'pinned', theme: pin },
    textSize: numeric(member(values, 'type.base'), 'type.base'),
    density,
    motion: 'system',
  };
  const environment: Environment = {
    scheme: theme?.id === 'ink' ? 'dark' : 'light',
    pointer: 'fine',
    reducedMotion,
    forcedColors: false,
  };
  return resolveUi(source, preferences, environment, identity).css;
}
/** Generated declarations are intentionally plain serialized values, with no raw source expressions. */
function rule(
  selector: string,
  values: Readonly<Record<string, string>>,
): string {
  return (
    selector +
    ' {\n' +
    Object.entries(values)
      .map(([name, value]) => '  ' + name + ': ' + value + ';')
      .join('\n') +
    '\n}'
  );
}
/** All generated styles participate in declared cascade layers. */
function layer(
  name: string,
  content: string,
): string {
  return (
    '/* Generated by Design System; do not edit. */\n@layer ' + name + ' {\n' + content + '\n}\n'
  );
}
/** Layout constants come from the same typed source used by JS; media conditions cannot use CSS vars. */
function layoutStyles(source: SourceSet): string {
  const values = resolveDefinitions(source.definitions).values;
  const medium = numeric(member(values, 'breakpoint.medium'), 'breakpoint.medium');
  const large = numeric(member(values, 'breakpoint.large'), 'breakpoint.large');
  return layer(
    'tokens',
    '[data-nv-scope="ui"] { --nv-layout-mode: compact; }\n@media (min-width: ' +
      medium +
      'px) { [data-nv-scope="ui"] { --nv-layout-mode: medium; } }\n@media (min-width: ' +
      large +
      'px) { [data-nv-scope="ui"] { --nv-layout-mode: wide; } }',
  );
}
/** Public TS vocabulary is generated from actual emitted identities, preventing hand-maintained drift. */
function tokenNames(source: SourceSet): string {
  const rows = source.definitions.map((item) => "  '" + cssName(item.id) + "',").join('\n');
  return (
    '/** Generated token vocabulary; regenerate through Design System compiler. */\nexport const tokenNames = [\n' +
    rows +
    '\n] as const;\n'
  );
}
/** Responsive JS and CSS share the same authored breakpoint values. */
function breakpoints(source: SourceSet): string {
  const values = resolveDefinitions(source.definitions).values;
  const medium = numeric(member(values, 'breakpoint.medium'), 'breakpoint.medium');
  const large = numeric(member(values, 'breakpoint.large'), 'breakpoint.large');
  return (
    '/** Generated breakpoints; regenerate through Design System compiler. */\nexport const breakpoints = {\n  medium: ' +
    medium +
    ',\n  large: ' +
    large +
    ',\n} as const;\n'
  );
}
