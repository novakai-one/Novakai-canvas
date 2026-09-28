/*
 * Why this file exists
 *
 * An agent draws a collection by typing `pnpm render:png --collection states --out out/`. Before
 * anything is drawn, the CLI must check those flags: what to draw, where to write it, and in which
 * format and theme.
 *
 * This file checks them and turns them into one `RenderChoice`. Each check gives back a `Result`
 * (see `contract/errors.ts`). Every mistake is `invalid-arguments`, followed by the usage line from
 * `flags.ts`, so the agent can fix the flag and try again. It never reads a file or makes a folder.
 */
import type { ArgvReading, RawArguments, RenderFlag } from '../../contract/records/arguments.js';
import type {
  CollectionSelector,
  LabelMode,
  RenderChoice,
  RenderFormat,
} from '../../contract/records/render.js';
import { recipeOrCollectionId, filePath, themeId } from '../../contract/brands.js';
import type { FilePath } from '../../contract/brands.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { flagAsTyped, formatNames, isRenderFormat, renderUsage } from './flags.js';
import type { OptionalFlag, RequiredFlag } from './flags.js';

/** The flags render:png read, as Node gave them. */
type RenderArguments = RawArguments<RenderFlag>;

/** A render:png flag that carries text: every flag but the `--labels` switch. */
type TextFlag = Exclude<RenderFlag, 'labels'>;

/** An optional flag that carries text. */
type OptionalTextFlag = Exclude<OptionalFlag, 'labels'>;

/** What to draw and where to write it: `--collection` and `--out`, checked. */
type CollectionAndOut = Pick<RenderChoice, 'collection' | 'out'>;

/** How to draw it: `--format`, and `--theme` and `--theme-file` when typed, checked. */
type FormatAndThemes = Pick<RenderChoice, 'format' | 'theme' | 'themeFile'>;

/** `--theme` and `--theme-file`, checked; each is left out when it wasn't typed. */
type ThemeFlags = Pick<RenderChoice, 'theme' | 'themeFile'>;

/** The section file format when --format is absent. */
const defaultFormat: RenderFormat = 'png';

/**
 * Checks the flags typed after `pnpm render:png`, and gives back what they ask for.
 *
 * `--collection` and `--out` must be typed. `--format` is `svg` or `png`, and `png` if not typed.
 * Mistakes: a flag Node couldn't read, a word that isn't a flag, a missing or empty `--collection`
 * or `--out`, an unknown `--format`, or an empty `--theme` or `--theme-file`.
 */
export function parseRenderChoice(typedLine: ArgvReading<RenderFlag>): Result<RenderChoice> {
  if (typedLine.kind === 'malformed') {
    return malformedFlagFailure(typedLine.flag);
  }
  const [strayWord] = typedLine.arguments.positionals;
  if (strayWord !== undefined) {
    return strayWordFailure(strayWord);
  }
  return checkRenderFlags(typedLine.arguments);
}

/** Checks every flag: first what to draw and where, then how. The first mistake stops it. */
function checkRenderFlags(rawArguments: RenderArguments): Result<RenderChoice> {
  const collectionAndOut = checkCollectionAndOutFlags(rawArguments);
  if (!collectionAndOut.ok) {
    return collectionAndOut;
  }
  const formatAndThemes = checkFormatAndThemeFlags(rawArguments);
  if (!formatAndThemes.ok) {
    return formatAndThemes;
  }
  const labels = chooseLabelMode(rawArguments);
  return success({ ...collectionAndOut.value, ...formatAndThemes.value, labels });
}

/** Checks `--collection`, then `--out`: the two flags render:png can't run without. */
function checkCollectionAndOutFlags(rawArguments: RenderArguments): Result<CollectionAndOut> {
  const collection = checkCollectionFlag(rawArguments);
  if (!collection.ok) {
    return collection;
  }
  const out = checkOutFlag(rawArguments);
  if (!out.ok) {
    return out;
  }
  return success({ collection: collection.value, out: out.value });
}

/** Checks `--format`, then `--theme` and `--theme-file`. */
function checkFormatAndThemeFlags(rawArguments: RenderArguments): Result<FormatAndThemes> {
  const format = checkFormatFlag(rawArguments);
  if (!format.ok) {
    return format;
  }
  const themeFlags = checkThemeFlags(rawArguments);
  if (!themeFlags.ok) {
    return themeFlags;
  }
  return success({ format: format.value, ...themeFlags.value });
}

/**
 * Checks `--collection`. Text ending in `.canvas` is a file, such as `my.canvas`. Any other text is
 * an ID, such as `states`, for a recipe or a shipped collection.
 */
function checkCollectionFlag(rawArguments: RenderArguments): Result<CollectionSelector> {
  const typedCollection = flagText(rawArguments, 'collection');
  if (typedCollection === undefined) {
    return requiredFlagFailure('collection');
  }
  if (isCanvasFileName(typedCollection)) {
    return checkCanvasFile(typedCollection);
  }
  return checkCollectionName(typedCollection);
}

/** Checks `--collection` text that names a `.canvas` file. */
function checkCanvasFile(typedPath: string): Result<CollectionSelector> {
  const path = filePath.safeParse(typedPath);
  if (!path.success) {
    return requiredFlagFailure('collection');
  }
  return success({ kind: 'file', path: path.data });
}

/** Checks `--collection` text that names a recipe or a shipped collection by its ID. */
function checkCollectionName(typedName: string): Result<CollectionSelector> {
  const name = recipeOrCollectionId.safeParse(typedName);
  if (!name.success) {
    return requiredFlagFailure('collection');
  }
  return success({ kind: 'id', id: name.data });
}

/** Checks `--out`, the folder to write to. */
function checkOutFlag(rawArguments: RenderArguments): Result<FilePath> {
  const typedOut = flagText(rawArguments, 'out');
  const out = filePath.safeParse(typedOut);
  if (!out.success) {
    return requiredFlagFailure('out');
  }
  return success(out.data);
}

/** Checks `--format`: `svg` or `png`, and `png` when it wasn't typed. */
function checkFormatFlag(rawArguments: RenderArguments): Result<RenderFormat> {
  const typedFormat = flagText(rawArguments, 'format') ?? defaultFormat;
  if (!isRenderFormat(typedFormat)) {
    return unknownFormatFailure();
  }
  return success(typedFormat);
}

/** Checks `--theme`, then `--theme-file`. */
function checkThemeFlags(rawArguments: RenderArguments): Result<ThemeFlags> {
  const theme = checkThemeFlag(rawArguments);
  if (!theme.ok) {
    return theme;
  }
  const themeFile = checkThemeFileFlag(rawArguments);
  if (!themeFile.ok) {
    return themeFile;
  }
  return success({ ...theme.value, ...themeFile.value });
}

/** Checks `--theme`, the ID of the theme to draw with. It is left out when it wasn't typed. */
function checkThemeFlag(rawArguments: RenderArguments): Result<Pick<ThemeFlags, 'theme'>> {
  const typedTheme = flagText(rawArguments, 'theme');
  if (typedTheme === undefined) {
    return success({});
  }
  const theme = themeId.safeParse(typedTheme);
  if (!theme.success) {
    return emptyFlagFailure('theme');
  }
  return success({ theme: theme.data });
}

/** Checks `--theme-file`, a `.theme` file to add. It is left out when it wasn't typed. */
function checkThemeFileFlag(rawArguments: RenderArguments): Result<Pick<ThemeFlags, 'themeFile'>> {
  const typedThemeFile = flagText(rawArguments, 'theme-file');
  if (typedThemeFile === undefined) {
    return success({});
  }
  const themeFile = filePath.safeParse(typedThemeFile);
  if (!themeFile.success) {
    return emptyFlagFailure('theme-file');
  }
  return success({ themeFile: themeFile.data });
}

/** Chooses which wire labels to draw: `all` when `--labels` was typed, else `default`. */
function chooseLabelMode(rawArguments: RenderArguments): LabelMode {
  if (rawArguments.values.get('labels') === true) {
    return 'all';
  }
  return 'default';
}

/** Gives the text typed after a flag, or nothing when the flag wasn't typed. */
function flagText(
  rawArguments: RenderArguments,
  flag: TextFlag,
): string | undefined {
  const typed = rawArguments.values.get(flag);
  if (typeof typed !== 'string') {
    return undefined;
  }
  return typed;
}

/** Whether `--collection` text names a `.canvas` file. */
function isCanvasFileName(typedCollection: string): boolean {
  return typedCollection.endsWith('.canvas');
}

/** Makes the mistake for a flag Node couldn't read, such as `--nope` (`invalid-arguments`). */
function malformedFlagFailure(flag: string): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`Unknown or malformed flag: ${flag}`);
}

/** Makes the mistake for a word typed on its own, since render:png takes flags only. */
function strayWordFailure(word: string): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`render:png takes no operands: ${word}`);
}

/** Makes the mistake for `--collection` or `--out` missing or empty. */
function requiredFlagFailure(flag: RequiredFlag): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${flagAsTyped(flag)} is required`);
}

/** Makes the mistake for a `--format` that isn't `svg` or `png`. */
function unknownFormatFailure(): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${flagAsTyped('format')} must be ${formatNames.join(' or ')}`);
}

/** Makes the mistake for `--theme` or `--theme-file` typed with no text after it. */
function emptyFlagFailure(flag: OptionalTextFlag): Result<never, LocalFailure> {
  return invalidArgumentsFailure(`${flagAsTyped(flag)} must not be empty`);
}

/** Makes an `invalid-arguments` mistake with this message, followed by the usage line. */
function invalidArgumentsFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message, recovery: renderUsage });
}
