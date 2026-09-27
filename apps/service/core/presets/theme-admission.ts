import type {
  Assets,
  AuthoringResult,
  Catalog,
  ChromeName,
  Json,
  LoweredIntent,
  Preset,
  Templates,
} from '../../contract/records/capabilities.js';
import {
  hexColour,
  rawFields,
  themeConfig,
  type ThemeConfig,
  type ThemeOverride,
} from '../../contract/records/presets/theme-input.js';
import { admissionFields } from '../../contract/records/presets/preparation.js';
import { chromeName } from '../../contract/schemas.js';
import { authoringFailure } from '../../contract/errors.js';
export interface ThemeAdmissionOwners {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}
type FontBinding = { readonly alias: string; readonly digest: string };
/** Prepare exact identities and owner-validated tokens; Authoring retains the draft on any typed failure. */
export function prepareTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly FontBinding[],
  owners: ThemeAdmissionOwners,
): AuthoringResult<Json> {
  try {
    return prepareSourceTheme(admission, catalog, bindings, owners);
  } catch {
    return authoringFailure('invalid-input', 'theme', 'Theme preparation failed');
  }
}
/** Only this protected adapter translates source syntax; Design System remains the token policy owner. */
function prepareSourceTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly { readonly alias: string; readonly digest: string }[],
  owners: ThemeAdmissionOwners,
): AuthoringResult<Json> {
  const parsed = themeConfig.safeParse(admission);
  if (!parsed.success) return { ok: true, value: admission };
  const base = owners.templates.read(catalog, selection(parsed.data.raw.base));
  if (!base.ok)
    return authoringFailure('invalid-input', base.error.path, base.error.message, [], base.error);
  return withFonts(admission, parsed.data.raw.overrides, base.value, bindings, owners.assets);
}
/** Resolve the two font descriptors only after the base selection is exact. */
function withFonts(
  admission: Json,
  overrides: ThemeConfig['raw']['overrides'],
  base: Preset,
  bindings: readonly { readonly alias: string; readonly digest: string }[],
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<Json> {
  const fonts = bindings.map((item) => font(item, assets));
  const failed = fonts.find((item) => !item.ok);
  if (failed) return failed;
  const header = admissionFields.parse(admission);
  const pin = {
    kind: base.kind,
    id: base.id,
    version: base.version,
    digest: base.digest,
  };
  return {
    ok: true,
    value: {
      ...header,
      raw: {
        ...chromeField(header.raw),
        base: { kind: 'preset', pin },
        fonts: Object.fromEntries(fonts.filter((item) => item.ok).map((item) => item.value)),
        overrides: Object.fromEntries(
          Object.entries(overrides).map(([id, value]) => [id, tokenValue(value)]),
        ),
      },
    },
  };
}
/** Exact pin syntax matches canonical Language readouts; bare IDs resolve once through Templates ordering. */
function selection(source: string): unknown {
  const exact = /^([^@]+)@([^#]+)#sha256:([a-f0-9]{64})$/.exec(source);
  if (exact) return { kind: 'theme', id: exact[1], version: exact[2], digest: exact[3] };
  return { kind: 'theme', id: source };
}
/** Font family is the Assets descriptor's verified family, never a caller-supplied name or OS fallback. */
function font(
  input: { readonly alias: string; readonly digest: string },
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<
  readonly [string, { readonly family: string; readonly digest: string; readonly approved: true }]
> {
  const blob = assets.resolve(input.digest);
  if (!blob.ok)
    return authoringFailure('missing-asset', blob.error.path, blob.error.message, [], blob.error);
  if (blob.value.descriptor.kind !== 'font' || blob.value.descriptor.fontFamily === null)
    return authoringFailure(
      'invalid-input',
      input.alias,
      'Theme input must identify a verified font',
    );
  return {
    ok: true,
    value: [
      input.alias,
      { family: blob.value.descriptor.fontFamily, digest: input.digest, approved: true },
    ],
  };
}

/** Numbers retain their owner-defined meaning; colors translate to the existing sRGB record. */
function tokenValue(value: ThemeOverride): Json {
  if (typeof value !== 'string') return value;
  return color(value);
}

/** Translate semantic hexadecimal color syntax into the existing Design System sRGB input shape. */
function color(value: string): Json {
  const hex = hexColour.parse(value);
  return {
    colorSpace: 'srgb',
    components: [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
    alpha: colorAlpha(hex),
  };
}

/** Six-digit colors are opaque; the optional final byte supplies the only alpha override. */
function colorAlpha(hex: string): number {
  if (hex.length !== 9) return 1;
  return Number.parseInt(hex.slice(7, 9), 16) / 255;
}

/** Preserve an explicitly authored chrome selector through resource preparation. */
function chromeField(raw: unknown): { readonly chrome?: ChromeName } {
  // Project one field from the guarded source envelope; unrelated admission keys stay intact.
  const record = rawFields.parse(raw);
  if (record.chrome === undefined) return {};
  return { chrome: chromeName.parse(record.chrome) };
}
