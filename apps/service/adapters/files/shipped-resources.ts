/*
 * Reads the installation's shipped resources: the bundled fonts (staged through Assets' font
 * codec), the Design System token sources and one recipe starter per family. Impure (file reads,
 * Assets staging). Nothing is admitted here: startup Authoring admission binds the presets and
 * owns commit and recovery. Bytes staged before a failure stay collectible; the caller repairs
 * the installation and retries.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { fontSet, fontSource } from '@novakai/canvas-presentation';
import type { FontSet, FontSource } from '@novakai/canvas-presentation';
import type { Assets, Digest } from '@novakai/canvas-assets';
import type { TokenFileBindings } from '@novakai/canvas-design-system';
import type { RecipePayload } from '@novakai/canvas-templates';
import type { BuiltinFonts, BuiltinSources } from '../../contract/records/presets/builtins.js';
import type { HostPath } from '../../contract/brands.js';
import { andThen, collect, failure, success, type Result } from '../../contract/errors.js';

/** The Assets operations a shipped font is staged and read back through. */
type FontStaging = Pick<Assets, 'stage' | 'resolve'>;

/** The Design System reader of the token source files. */
type TokenSourceReader = Pick<TokenFileBindings, 'source'>;

/** One shipped recipe starter: its family and DSL source. */
type ShippedRecipe = BuiltinSources['recipes'][number];

/** The files the installation ships, by kind. */
interface ShippedManifest {
  /** The file of each font role, under `fonts/`. */
  readonly fonts: Readonly<Record<keyof BuiltinFonts, string>>;
  /** The starter file of each recipe family, under `recipes/`, in catalog order. */
  readonly recipes: Readonly<Record<RecipePayload['family'], string>>;
}

/**
 * The closed installation manifest: the only files read under the resource root, so authored DSL
 * cannot select a service path.
 */
const SHIPPED_MANIFEST: ShippedManifest = Object.freeze({
  fonts: Object.freeze({
    body: 'inter-latin-400-normal.woff2',
    mono: 'jetbrains-mono-latin-400-normal.woff2',
    strong: 'inter-tight-latin-700-normal.woff2',
  }),
  recipes: Object.freeze({
    er: 'er.canvas',
    modules: 'modules.canvas',
    sop: 'sop.canvas',
    mindmap: 'mindmap.canvas',
    sequence: 'sequence.canvas',
    infographic: 'infographic.canvas',
  }),
});

/** The font roles in `BuiltinSources.fonts` wire order: body, mono, strong. */
const FONT_WIRE_ORDER: readonly (keyof BuiltinFonts)[] = Object.freeze([
  'body',
  'mono',
  'strong',
] as const);

/** The licence every shipped font is staged under. */
const FONT_LICENSE = 'SIL Open Font License 1.1';

/**
 * Reads the shipped sources for startup.
 *
 * Steps, started together; once all have finished, the first failure in this order is returned:
 * 1. Stage each shipped font and read it back as Presentation's font set (see `stageFonts`).
 * 2. Read the Design System token sources.
 * 3. Read each shipped recipe starter (see `readRecipes`).
 *
 * Nothing is admitted. Fails with `unavailable` at `builtins` ("Bundled fonts, recipes or token
 * definitions could not be loaded") when a shipped file cannot be read, Assets or the Design
 * System rejects a resource, or Presentation rejects a font. The owner's failure is not kept.
 * Assets and the Design System answer with Results; one that throws instead gets the same
 * failure (caught here).
 */
export async function loadBuiltinSources(
  resourceRoot: HostPath,
  assets: FontStaging,
  tokens: TokenSourceReader,
): Promise<Result<BuiltinSources>> {
  try {
    return await readShippedSources(resourceRoot, assets, tokens);
  } catch {
    return builtinsUnavailable();
  }
}

/** Reads the fonts, token sources and recipes together (see `loadBuiltinSources`). */
async function readShippedSources(
  resourceRoot: HostPath,
  assets: FontStaging,
  tokens: TokenSourceReader,
): Promise<Result<BuiltinSources>> {
  const [fonts, tokenSources, recipes] = await Promise.all([
    stageFonts(resourceRoot, assets),
    readTokenSources(tokens),
    readRecipes(resourceRoot),
  ]);
  if (!fonts.ok) return fonts;
  if (!tokenSources.ok) return tokenSources;
  return andThen(recipes, (starters) =>
    success({ fonts: fonts.value, tokens: tokenSources.value, recipes: starters }),
  );
}

/**
 * Stages every shipped font together (see `stageFont`), then checks them, in wire order, as
 * Presentation's font set. Fails as `stageFont` fails (the first failure in wire order), or with
 * the builtins failure when Presentation rejects the set.
 */
async function stageFonts(
  root: HostPath,
  assets: FontStaging,
): Promise<Result<FontSet>> {
  const staged = await Promise.all(
    FONT_WIRE_ORDER.map((role) => stageFont(root, SHIPPED_MANIFEST.fonts[role], assets)),
  );
  const inWireOrder = collect(staged, (font) => font);
  return andThen(inWireOrder, (fonts) => parseShipped(fontSet, fonts));
}

/**
 * Stages the font file's exact bytes through Assets' font codec, then reads the stored font back
 * (see `readStagedFont`). Fails with the builtins failure when the file cannot be read or Assets
 * rejects the bytes.
 */
async function stageFont(
  root: HostPath,
  file: string,
  assets: FontStaging,
): Promise<Result<FontSource>> {
  const bytes = await readShippedFile(join(root, 'fonts', file));
  if (!bytes.ok) return bytes;
  const admission = fromOwner(
    await assets.stage({
      base64: bytes.value.toString('base64'),
      mediaType: 'font/woff2',
      alt: file,
      provenance: { source: `bundled:fonts/${file}`, license: FONT_LICENSE },
    }),
  );
  return andThen(admission, (admitted) => readStagedFont(admitted.descriptor.digest, assets));
}

/**
 * The staged font as a Presentation font source: digest, family, media type and bytes as Assets
 * stored them. Fails with the builtins failure when Assets cannot resolve the digest or
 * Presentation rejects the source.
 */
function readStagedFont(
  digest: Digest,
  assets: FontStaging,
): Result<FontSource> {
  const blob = fromOwner(assets.resolve(digest));
  return andThen(blob, (stored) =>
    parseShipped(fontSource, {
      digest: stored.descriptor.digest,
      family: stored.descriptor.fontFamily,
      mediaType: stored.descriptor.mediaType,
      base64: stored.base64,
    }),
  );
}

/** The Design System token sources. Fails with the builtins failure when it cannot read them. */
async function readTokenSources(
  tokens: TokenSourceReader,
): Promise<Result<BuiltinSources['tokens']>> {
  return fromOwner(await tokens.source.read());
}

/**
 * Every shipped recipe starter, read together, in catalog order (the manifest's key order). Fails
 * as `readRecipe` fails (the first failure in catalog order).
 */
async function readRecipes(root: HostPath): Promise<Result<readonly ShippedRecipe[]>> {
  const families = Object.keys(SHIPPED_MANIFEST.recipes).filter(isRecipeFamily);
  const recipes = await Promise.all(families.map((family) => readRecipe(root, family)));
  return collect(recipes, (recipe) => recipe);
}

/**
 * Whether the manifest key is a recipe family. Every key is one; this only narrows the strings
 * `Object.keys` returns.
 */
function isRecipeFamily(key: string): key is RecipePayload['family'] {
  return Object.hasOwn(SHIPPED_MANIFEST.recipes, key);
}

/**
 * The family's starter file (see `SHIPPED_MANIFEST`) as UTF-8 text. Fails with the builtins
 * failure when the file cannot be read.
 */
async function readRecipe(
  root: HostPath,
  family: RecipePayload['family'],
): Promise<Result<ShippedRecipe>> {
  const bytes = await readShippedFile(join(root, 'recipes', SHIPPED_MANIFEST.recipes[family]));
  return andThen(bytes, (source) => success({ family, source: source.toString('utf8') }));
}

/**
 * The shipped file's bytes. Fails with the builtins failure when it cannot be read (Node's throw,
 * caught here).
 */
async function readShippedFile(path: string): Promise<Result<Buffer>> {
  try {
    return success(await readFile(path));
  } catch {
    return builtinsUnavailable();
  }
}

/** The owner's value. An owner rejection becomes the builtins failure. */
function fromOwner<T>(
  outcome: { readonly ok: true; readonly value: T } | { readonly ok: false },
): Result<T> {
  if (!outcome.ok) return builtinsUnavailable();
  return success(outcome.value);
}

/** The input as the schema reads it. Fails with the builtins failure when the schema rejects it. */
function parseShipped<T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return builtinsUnavailable();
  return success(parsed.data);
}

/** The one shipped-resource failure: `unavailable` at `builtins`. */
function builtinsUnavailable(): Result<never> {
  return failure(
    'unavailable',
    'builtins',
    'Bundled fonts, recipes or token definitions could not be loaded',
  );
}
