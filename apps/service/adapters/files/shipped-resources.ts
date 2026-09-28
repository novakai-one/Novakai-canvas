/*
 * Why this file exists
 *
 * Every workspace starts with the same built-in fonts, design tokens and recipe starters. They ship
 * with the app, in the resource folder. For example, `fonts/inter-latin-400-normal.woff2` is the
 * body text font.
 *
 * This file reads those shipped files at start-up. Each font is stored through Assets and read
 * back. It reads only the fixed list of files below, so no diagram can name another path. It never
 * saves a theme or recipe to the workspace: start-up makes those from these files and saves them
 * through Authoring.
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
import { collect, failure, success, type Result } from '../../contract/errors.js';

/** The part of Assets a shipped font is stored through (`stage`) and read back from (`resolve`). */
export type FontStore = Pick<Assets, 'stage' | 'resolve'>;

/** The part of the Design System that reads the design token source files. */
export type TokenSourceReader = Pick<TokenFileBindings, 'source'>;

/** One shipped recipe starter: its family and DSL source. */
type ShippedRecipe = BuiltinSources['recipes'][number];

/** What Assets is asked to store for one shipped font. */
interface FontUpload {
  readonly base64: string;
  readonly mediaType: 'font/woff2';
  readonly alt: string;
  readonly provenance: { readonly source: string; readonly license: string };
}

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
 * Reads the shipped fonts, design token sources and recipe starters from `resourceRoot`. Each font
 * is stored through `assets` and read back, so its bytes are the ones Assets keeps.
 * Fails with `unavailable` at `builtins` when a shipped file can't be read, or Assets, the Design
 * System or Presentation refuses one. Their own mistake is not kept.
 */
export async function loadBuiltinSources(
  resourceRoot: HostPath,
  assets: FontStore,
  tokens: TokenSourceReader,
): Promise<Result<BuiltinSources>> {
  try {
    return await readShippedSources(resourceRoot, assets, tokens);
  } catch {
    return builtinsFailure();
  }
}

/**
 * Reads the fonts, token sources and recipe starters at the same time, then puts them together.
 * The first mistake, in that order, is the answer.
 */
async function readShippedSources(
  resourceRoot: HostPath,
  assets: FontStore,
  tokens: TokenSourceReader,
): Promise<Result<BuiltinSources>> {
  const [fonts, tokenSources, recipes] = await Promise.all([
    stageFonts(resourceRoot, assets),
    readTokenSources(tokens),
    readRecipes(resourceRoot),
  ]);
  if (!fonts.ok) {
    return fonts;
  }
  if (!tokenSources.ok) {
    return tokenSources;
  }
  return assembleSources(fonts.value, tokenSources.value, recipes);
}

/** Puts the fonts, token sources and recipe starters together, once the recipes were read too. */
function assembleSources(
  fonts: FontSet,
  tokenSources: BuiltinSources['tokens'],
  recipes: Result<readonly ShippedRecipe[]>,
): Result<BuiltinSources> {
  if (!recipes.ok) {
    return recipes;
  }
  const sources: BuiltinSources = { fonts, tokens: tokenSources, recipes: recipes.value };
  return success(sources);
}

/**
 * Stores every shipped font through Assets at the same time, then checks them, in wire order, as
 * Presentation's font set.
 */
async function stageFonts(
  root: HostPath,
  assets: FontStore,
): Promise<Result<FontSet>> {
  const fontFiles = FONT_WIRE_ORDER.map((role) => SHIPPED_MANIFEST.fonts[role]);
  const stagedFonts = await Promise.all(fontFiles.map((file) => stageFont(root, file, assets)));
  const fontSources = collectValues(stagedFonts);
  if (!fontSources.ok) {
    return fontSources;
  }
  return parseShipped(fontSet, fontSources.value);
}

/** Stores one font file's exact bytes through Assets, then reads the stored font back. */
async function stageFont(
  root: HostPath,
  file: string,
  assets: FontStore,
): Promise<Result<FontSource>> {
  const bytes = await readShippedFile(join(root, 'fonts', file));
  if (!bytes.ok) {
    return bytes;
  }
  const staged = await assets.stage(fontUpload(file, bytes.value));
  if (!staged.ok) {
    return builtinsFailure();
  }
  return readStagedFont(staged.value.descriptor.digest, assets);
}

/** Describes one shipped font for Assets: its bytes, media type, name, origin and licence. */
function fontUpload(
  file: string,
  bytes: Buffer,
): FontUpload {
  return {
    base64: bytes.toString('base64'),
    mediaType: 'font/woff2',
    alt: file,
    provenance: { source: `bundled:fonts/${file}`, license: FONT_LICENSE },
  };
}

/** Reads the stored font back from Assets as Presentation's font source. */
function readStagedFont(
  digest: Digest,
  assets: FontStore,
): Result<FontSource> {
  const stored = assets.resolve(digest);
  if (!stored.ok) {
    return builtinsFailure();
  }
  const { descriptor, base64 } = stored.value;
  const storedFont = {
    digest: descriptor.digest,
    family: descriptor.fontFamily,
    mediaType: descriptor.mediaType,
    base64,
  };
  return parseShipped(fontSource, storedFont);
}

/** Reads the design token source files through the Design System. */
async function readTokenSources(
  tokens: TokenSourceReader,
): Promise<Result<BuiltinSources['tokens']>> {
  const tokenSources = await tokens.source.read();
  if (!tokenSources.ok) {
    return builtinsFailure();
  }
  return success(tokenSources.value);
}

/** Reads every recipe starter at the same time, and keeps them in catalog order. */
async function readRecipes(root: HostPath): Promise<Result<readonly ShippedRecipe[]>> {
  const families = Object.keys(SHIPPED_MANIFEST.recipes).filter(isRecipeFamily);
  const recipes = await Promise.all(families.map((family) => readRecipe(root, family)));
  return collectValues(recipes);
}

/**
 * Whether the manifest key is a recipe family. Every key is one; this only narrows the strings
 * `Object.keys` returns.
 */
function isRecipeFamily(key: string): key is RecipePayload['family'] {
  return Object.hasOwn(SHIPPED_MANIFEST.recipes, key);
}

/** Reads one family's starter file (see `SHIPPED_MANIFEST`) as UTF-8 text. */
async function readRecipe(
  root: HostPath,
  family: RecipePayload['family'],
): Promise<Result<ShippedRecipe>> {
  const file = join(root, 'recipes', SHIPPED_MANIFEST.recipes[family]);
  const bytes = await readShippedFile(file);
  if (!bytes.ok) {
    return bytes;
  }
  const recipe: ShippedRecipe = { family, source: bytes.value.toString('utf8') };
  return success(recipe);
}

/** Reads one shipped file's bytes. */
async function readShippedFile(path: string): Promise<Result<Buffer>> {
  try {
    const bytes = await readFile(path);
    return success(bytes);
  } catch {
    return builtinsFailure();
  }
}

/** Gives back every value, in order, or the first mistake among them. */
function collectValues<T>(outcomes: readonly Result<T>[]): Result<readonly T[]> {
  return collect(outcomes, (outcome) => outcome);
}

/** Checks a shipped part with its schema. */
function parseShipped<T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return builtinsFailure();
  }
  return success(parsed.data);
}

/** Makes the one mistake for shipped files: a file, or an owner's check of it, failed. */
function builtinsFailure(): Result<never> {
  return failure(
    'unavailable',
    'builtins',
    'Bundled fonts, recipes or token definitions could not be loaded',
  );
}
