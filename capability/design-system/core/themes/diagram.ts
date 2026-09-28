import { hexColor, type ChromeName, type TokenId, tokenId } from '../../contract/brands.js';
import type { ResolvedTokenSet } from '../../contract/records/resolved.js';
import type {
  StyleProjection,
  Paint,
  FontPin,
  PresetPin,
  TextMetric,
  DiagramTypography,
  ContentSizing,
  SizeBand,
} from '../../contract/records/theme.js';
import type { SourceSet } from '../../contract/records/source.js';
import type { Identity } from '../../contract/ports/identity.js';
import type { TokenValues } from '../../contract/records/tokens.js';
import { member, parsed } from '../validation/input.js';
import { accepted, reject } from '../validation/outcomes.js';
import { canonical } from '../validation/canonical.js';
import { resolveDefinitions } from '../tokens/resolve.js';
import { validateBounds } from '../tokens/bounds.js';
import { validateContrast } from '../tokens/contrast.js';
import { emitVariables } from '../tokens/emit.js';
import { numeric, colorText } from '../tokens/values.js';
import { chromeField } from './chrome.js';
import { fromPortable } from './portable.js';
import { changedDefinitions } from './overrides.js';
import { validateFonts, requirePinnedFont } from './fonts.js';
/** Resolve pinned diagram data; the public facade returns typed failure and the host retains its prior scope. */
export function resolveDiagram(
  source: SourceSet,
  input: unknown,
  fonts: readonly FontPin[],
  pin: PresetPin,
  scope: 'diagram' | 'export',
  identity: Identity,
): ResolvedTokenSet {
  const portable = fromPortable(input, source, fonts);
  // Derived values are always re-derived from the roots, so a theme saved under older recipes still loads.
  const base = rootsOnly(source, portable.values);
  const overrides = scope === 'export' ? { ...base, ...noMotion() } : base;
  const resolved = resolveDefinitions(changedDefinitions(source, overrides));
  validateBounds(source, resolved.values, scope);
  validateFonts(source, resolved.values, fonts, scope);
  const contrast = validateContrast(source, resolved.values, portable.theme.roles);
  const inputDigest = accepted(
    identity.hash(
      canonical({ source: source.definitionVersion, theme: portable.theme, pin, scope }),
    ),
  );
  const digest = accepted(identity.hash(canonical({ scope, values: resolved.values, fonts, pin })));
  return {
    ...interfaceRoleField(portable.theme.base === null),
    ...chromeField(portable.theme.chrome),
    definitionVersion: source.definitionVersion,
    inputDigest,
    digest,
    scope,
    values: resolved.values,
    css: emitVariables(resolved.values),
    dependencies: resolved.dependencies,
    primary: source.policy.primary,
    contrast,
    fonts,
    roles: portable.theme.roles,
    provenance: { ui: null, diagram: pin },
    forcedColors: false,
  };
}
/** Only UI-derived diagram themes follow the browser interface palette for standard semantic roles. */
function interfaceRoleField(enabled: boolean): { readonly followsInterfaceRoles?: true } {
  if (!enabled) return {};
  return { followsInterfaceRoles: true };
}
/** Re-evaluate admitted roots; the public resolver owns rejection and the host retains its prior scope. */
export function rootsOnly(
  source: SourceSet,
  values: TokenValues,
): TokenValues {
  return Object.fromEntries(
    source.definitions
      .filter((item) => item.expression.op === 'literal')
      .map((item) => [item.id, member(values, item.id)]),
  );
}
/** Export has no transition timeline; layout dimensions and color remain canonical. */
function noMotion(): TokenValues {
  return {
    [tokenId.parse('motion.duration')]: { type: 'duration', value: 0, unit: 'ms' },
    [tokenId.parse('camera.duration')]: { type: 'duration', value: 0, unit: 'ms' },
  };
}
/** Project exact resolved data; the public facade returns typed failure and the host retains its prior scope. */
export function projectDiagram(resolved: ResolvedTokenSet): StyleProjection {
  if (resolved.scope === 'ui')
    return reject(
      'invalid-input',
      'scope',
      'diagram or export',
      'UI scope cannot measure diagrams',
    );
  const values = resolved.values;
  const color = (id: string): string => colorText(member(values, id), id);
  return {
    ...interfaceRoleField(resolved.followsInterfaceRoles === true),
    ...chromeProjection(resolved),
    digest: resolved.digest,
    bodyFont: fontReference(requirePinnedFont('font.body', values, resolved.fonts)),
    monoFont: fontReference(requirePinnedFont('font.mono', values, resolved.fonts)),
    strongFont: fontReference(requirePinnedFont('font.strong', values, resolved.fonts)),
    typography: typography(resolved),
    contentSizing: contentSizing(values),
    connection: {
      ...wireOverride(resolved),
      paint: {
        fill: color('surface.base'),
        stroke: runtimeStroke(resolved),
        text: color('text.primary'),
      },
      width: tokenNumber(values, 'diagram.edgeStroke'),
      dash: [tokenNumber(values, 'space.2'), tokenNumber(values, 'space.1')],
    },
    padding: tokenNumber(values, 'space.3'),
    gap: tokenNumber(values, 'space.2'),
    stroke: tokenNumber(values, 'stroke.base'),
    radius: tokenNumber(values, 'shape.radius'),
    roles: Object.fromEntries(
      resolved.roles.map((role) => [role, rolePaint(role, values, resolved.chrome)]),
    ),
    surface: color('surface.base'),
    text: color('text.primary'),
    secondary: color('text.secondary'),
    border: color('border.default'),
  };
}
/** Presentation needs exact bytes and family, not the admission-evidence flag. */
function fontReference(font: FontPin): TextMetric['font'] {
  return { family: font.family, digest: font.digest };
}
/** The frozen role-token mapping works for built-in and declared additional roles equally. */
function rolePaint(
  role: ResolvedTokenSet['roles'][number],
  values: TokenValues,
  chrome: ChromeName | undefined,
): Paint {
  const prefix = tokenId.parse('role.' + role);
  return {
    ...secondaryPaint(prefix, values, chrome),
    fill: colorText(member(values, prefix + '.fill'), prefix),
    stroke: colorText(member(values, prefix + '.stroke'), prefix),
    text: colorText(member(values, prefix + '.text'), prefix),
  };
}

/** Resolve one absolute text role; resolver boundary translates missing tokens into typed failure. */
function metric(
  resolved: ResolvedTokenSet,
  font: string,
  sizeToken: string,
): TextMetric {
  const size = metricNumber(tokenNumber(resolved.values, sizeToken), sizeToken);
  const ratio = tokenNumber(resolved.values, 'lineHeight.body');
  return {
    font: fontReference(requirePinnedFont(font, resolved.values, resolved.fonts)),
    size,
    lineHeight: metricNumber(size * ratio, sizeToken + '.lineHeight'),
  };
}
/** Heading roles carry the admitted strong face; body-family roles keep reading weight. */
function typography(resolved: ResolvedTokenSet): DiagramTypography {
  return {
    sectionHeading: metric(resolved, 'font.strong', 'font.large'),
    nodeHeading: metric(resolved, 'font.strong', 'font.title'),
    body: metric(resolved, 'font.body', 'type.base'),
    mono: metric(resolved, 'font.mono', 'type.base'),
    annotation: metric(resolved, 'font.body', 'font.caption'),
    caption: metric(resolved, 'font.body', 'font.caption'),
  };
}
/** Width bands describe interior content; token validation owns finite positive values. */
function band(
  values: TokenValues,
  preferred: string,
  maximum: string,
): SizeBand {
  return {
    preferred: tokenNumber(values, preferred),
    maximum: tokenNumber(values, maximum),
  };
}
/** Shared content policies are derived from semantic tokens for all renderers. */
function contentSizing(values: TokenValues): ContentSizing {
  return {
    widths: {
      small: band(values, 'diagram.widthSmall', 'diagram.widthMedium'),
      medium: band(values, 'diagram.widthMedium', 'diagram.widthLarge'),
      large: band(values, 'diagram.widthLarge', 'diagram.widthExtraLarge'),
    },
    figureBox: {
      small: tokenNumber(values, 'diagram.figureSmall'),
      medium: tokenNumber(values, 'diagram.figureMedium'),
      large: tokenNumber(values, 'diagram.figureLarge'),
    },
    rowMinimum: tokenNumber(values, 'diagram.rowMin'),
    iconBox: {
      small: tokenNumber(values, 'diagram.iconSmall'),
      medium: tokenNumber(values, 'diagram.iconMedium'),
      large: tokenNumber(values, 'diagram.iconLarge'),
    },
  };
}
/** Numeric token extraction has one local policy for projection consumers. */
function tokenNumber(
  values: TokenValues,
  id: string,
): number {
  return numeric(member(values, id), id);
}
/** Presentation-bound metrics must satisfy its finite positive public schema. */
function metricNumber(
  value: number,
  path: string,
): number {
  if (!Number.isFinite(value) || value <= 0 || value > 10000)
    return reject(
      'invalid-input',
      path,
      'finite positive metric no greater than10000',
      'Derived diagram metric is outside Presentation bounds',
    );
  return value;
}

/** Legacy projections stay structurally identical; chrome values only enter explicitly selected presets. */
function chromeProjection(resolved: ResolvedTokenSet): Partial<StyleProjection> {
  if (resolved.chrome === undefined) return {};
  const values = resolved.values;
  return {
    chrome: resolved.chrome,
    headers: Object.fromEntries(
      resolved.roles.map((role) => [
        role,
        parsed(hexColor, colorText(member(values, 'role.' + role + '.header'), role), role),
      ]),
    ),
    elevation: {
      offsetX: tokenNumber(values, 'elevation.offsetX'),
      offsetY: tokenNumber(values, 'elevation.offsetY'),
      blur: tokenNumber(values, 'elevation.blur'),
      extent: tokenNumber(values, 'elevation.extent'),
      color: parsed(
        hexColor,
        colorText(member(values, 'elevation.color'), 'elevation.color'),
        'elevation.color',
      ),
    },
    chromeMetrics: {
      tabWidth: tokenNumber(values, 'chrome.tabWidth'),
      tabHeight: tokenNumber(values, 'chrome.tabHeight'),
      accentWidth: tokenNumber(values, 'chrome.accentWidth'),
    },
  };
}

/** Existing presets retain their original wire paint; chrome presets select runtime ink through tokens. */
function runtimeStroke(resolved: ResolvedTokenSet): Paint['stroke'] {
  const id = resolved.chrome === undefined ? 'text.secondary' : 'chrome.wire';
  return colorText(member(resolved.values, id), id);
}
/** Type-only and external interactions retain their own muted ink without changing marker or routing policy. */
function wireOverride(resolved: ResolvedTokenSet): Partial<StyleProjection['connection']> {
  if (resolved.chrome === undefined) return {};
  const color = (id: TokenId): Paint['fill'] => colorText(member(resolved.values, id), id);
  return {
    dashedPaint: {
      fill: color(tokenId.parse('surface.base')),
      stroke: color(tokenId.parse('chrome.externalWire')),
      text: color(tokenId.parse('text.primary')),
    },
  };
}

/** Secondary role ink stays absent from legacy paint records and readable on each role's own fill. */
function secondaryPaint(
  prefix: TokenId,
  values: TokenValues,
  chrome: ChromeName | undefined,
): Partial<Paint> {
  if (chrome === undefined) return {};
  return {
    secondary: parsed(hexColor, colorText(member(values, prefix + '.secondary'), prefix), prefix),
  };
}
