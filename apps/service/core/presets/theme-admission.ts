import { z } from 'zod';
import { chromeName, type ChromeName } from '@novakai/canvas-design-system';
import type { Assets } from '@novakai/canvas-assets';
import type { Catalog, Templates } from '@novakai/canvas-templates';
import type { LoweredIntent } from '@novakai/canvas-language';
import { failure } from '@novakai/canvas-authoring';
import type { Result, Json } from '@novakai/canvas-authoring';
const config = z.looseObject({
  kind: z.literal('theme'),
  raw: z.strictObject({
    // chromeField rejects malformed selectors instead of bypassing source preparation.
    chrome: z.unknown().optional(),
    base: z.string(),
    overrides: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.strictObject({ value: z.number().finite(), unit: z.literal('px') }).readonly(),
      ]),
    ),
  }),
});
type ThemeOwners = {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
};
type FontBinding = { readonly alias: string; readonly digest: string };
/** Prepare exact identities and owner-validated tokens; Authoring retains the draft on any typed failure. */
export function prepareTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly FontBinding[],
  owners: ThemeOwners,
): Result<Json> {
  try {
    return prepareSourceTheme(admission, catalog, bindings, owners);
  } catch {
    return failure('invalid-input', 'theme', 'Theme preparation failed');
  }
}
/** Only this protected adapter translates source syntax; Design System remains the token policy owner. */
function prepareSourceTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly { readonly alias: string; readonly digest: string }[],
  owners: ThemeOwners,
): Result<Json> {
  const parsed = config.safeParse(admission);
  if (!parsed.success) return { ok: true, value: admission };
  const base = owners.templates.read(catalog, selection(parsed.data.raw.base));
  if (!base.ok)
    return failure('invalid-input', base.error.path, base.error.message, [], base.error);
  return withFonts(admission, parsed.data.raw.overrides, base.value, bindings, owners.assets);
}
/** Resolve the two font descriptors only after the base selection is exact. */
function withFonts(
  admission: Json,
  overrides: z.infer<typeof config>['raw']['overrides'],
  base: import('@novakai/canvas-templates').Preset,
  bindings: readonly { readonly alias: string; readonly digest: string }[],
  assets: Pick<Assets, 'resolve'>,
): Result<Json> {
  const fonts = bindings.map((item) => font(item, assets));
  const failed = fonts.find((item) => !item.ok);
  if (failed) return failed;
  const header = z.record(z.string(), z.json()).parse(admission);
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
): Result<
  readonly [string, { readonly family: string; readonly digest: string; readonly approved: true }]
> {
  const blob = assets.resolve(input.digest);
  if (!blob.ok)
    return failure('missing-asset', blob.error.path, blob.error.message, [], blob.error);
  if (blob.value.descriptor.kind !== 'font' || blob.value.descriptor.fontFamily === null)
    return failure('invalid-input', input.alias, 'Theme input must identify a verified font');
  return {
    ok: true,
    value: [
      input.alias,
      { family: blob.value.descriptor.fontFamily, digest: input.digest, approved: true },
    ],
  };
}

/** Numbers retain their owner-defined meaning; colors translate to the existing sRGB record. */
function tokenValue(value: z.infer<typeof config>['raw']['overrides'][string]): Json {
  if (typeof value !== 'string') return value;
  return color(value);
}

/** Translate semantic hexadecimal color syntax into the existing Design System sRGB input shape. */
function color(value: string): Json {
  const hex = z
    .string()
    .regex(/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/)
    .parse(value);
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
  const record = z.record(z.string(), z.unknown()).parse(raw);
  if (record.chrome === undefined) return {};
  return { chrome: chromeName.parse(record.chrome) };
}
