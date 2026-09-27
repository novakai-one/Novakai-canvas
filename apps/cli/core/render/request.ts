/*
 * `pnpm render:png` argv → RenderRequest, checked in the base render's order: Node accepted the
 * flags; no operand; --collection; --out; --format; --theme; --theme-file; then the repo root.
 * Pure. Every failure is `invalid-arguments` and comes before any file is read or any temporary
 * store is made: the caller corrects the named flag and runs render:png again.
 */
import type { ArgvReading, RawArguments, RenderFlag } from '../../contract/records/arguments.js';
import type {
  CollectionSelector,
  LabelMode,
  RenderFormat,
  RenderRequest,
} from '../../contract/records/render.js';
import { collectionName, filePath, themeName } from '../../contract/brands.js';
import type { FilePath } from '../../contract/brands.js';
import type { FailureInput, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { joined, mapped } from '../shared/results.js';

/** The flags render:png read, as Node gave them. */
type RenderArguments = RawArguments<RenderFlag>;

/** A render:png flag that carries text: every flag but the `--labels` switch. */
type TextFlag = Exclude<RenderFlag, 'labels'>;

/** What to type instead, after any argument failure. */
const renderUsage =
  'Use render:png --collection ID|FILE.canvas --out DIR [--format png|svg] [--theme ID] [--theme-file FILE] [--labels].';

/** The section file format when --format is absent. */
const defaultFormat: RenderFormat = 'png';

/** Every section file format, keyed by itself. */
const renderFormats: Readonly<Record<RenderFormat, RenderFormat>> = Object.freeze({
  svg: 'svg',
  png: 'png',
});

/**
 * The render `reading` asks for, below the repo `root` the executable found. --labels cannot fail.
 * Fails with `invalid-arguments`: a flag Node refused (unknown, a text flag with no value, a value
 * on --labels), any operand, a missing or empty --collection or --out, a --format other than svg or
 * png, an empty --theme or --theme-file, or an empty root.
 */
export function parseRenderRequest(
  reading: ArgvReading<RenderFlag>,
  root: string,
): Result<RenderRequest> {
  if (reading.kind === 'malformed') return invalidArguments('Unknown or malformed render:png flag');
  return flagsOnly(reading.arguments, root);
}

/** Every word is refused: render:png takes flags only. Fails with `invalid-arguments`. */
function flagsOnly(
  raw: RenderArguments,
  root: string,
): Result<RenderRequest> {
  const [word] = raw.positionals;
  if (word !== undefined) return invalidArguments(`render:png takes no operands: ${word}`);
  return request(raw, root);
}

/** --collection, --out, --format, the theme flags, then the root; the first failure wins. */
function request(
  raw: RenderArguments,
  root: string,
): Result<RenderRequest> {
  const target = joined(selector(raw), outputDirectory(raw), (collection, out) => ({
    collection,
    out,
  }));
  const formatted = joined(target, sectionFormat(raw), (fields, format) => ({ ...fields, format }));
  const themed = joined(formatted, themeChoice(raw), (fields, themes) => ({
    ...fields,
    ...themes,
  }));
  return joined(themed, repoRoot(root), (fields, directory) => ({
    ...fields,
    labels: labelMode(raw),
    root: directory,
  }));
}

/**
 * --collection. Text ending in `.canvas` is a file; any other text names a recipe or a shipped
 * collection. Fails with `invalid-arguments` when absent or empty.
 */
function selector(raw: RenderArguments): Result<CollectionSelector> {
  const text = flagText(raw, 'collection');
  if (isCanvasFile(text))
    return mapped(checked(filePath, text, required('--collection')), (path) => ({
      kind: 'file',
      path,
    }));
  return mapped(checked(collectionName, text, required('--collection')), (name) => ({
    kind: 'named',
    name,
  }));
}

/** --out, as given. Fails with `invalid-arguments` when absent or empty. */
function outputDirectory(raw: RenderArguments): Result<FilePath> {
  return checked(filePath, flagText(raw, 'out'), required('--out'));
}

/** --format: svg or png; png when absent. Fails with `invalid-arguments`. */
function sectionFormat(raw: RenderArguments): Result<RenderFormat> {
  const text = flagText(raw, 'format') ?? defaultFormat;
  if (!isRenderFormat(text)) return invalidArguments('--format must be svg or png');
  return success(text);
}

/** --theme, then --theme-file; an absent one stays absent. Fails with `invalid-arguments`. */
function themeChoice(raw: RenderArguments): Result<Pick<RenderRequest, 'theme' | 'themeFile'>> {
  return joined(themeFlag(raw), themeFileFlag(raw), (theme, themeFile) => ({
    ...theme,
    ...themeFile,
  }));
}

/** --theme; absent stays absent. Fails with `invalid-arguments` when empty. */
function themeFlag(raw: RenderArguments): Result<Pick<RenderRequest, 'theme'>> {
  const text = flagText(raw, 'theme');
  if (text === undefined) return success({});
  return mapped(checked(themeName, text, empty('--theme')), (theme) => ({ theme }));
}

/** --theme-file; absent stays absent. Fails with `invalid-arguments` when empty. */
function themeFileFlag(raw: RenderArguments): Result<Pick<RenderRequest, 'themeFile'>> {
  const text = flagText(raw, 'theme-file');
  if (text === undefined) return success({});
  return mapped(checked(filePath, text, empty('--theme-file')), (themeFile) => ({ themeFile }));
}

/**
 * The repo root the executable found from its own location. Fails with `invalid-arguments` only if
 * it were empty.
 */
function repoRoot(root: string): Result<FilePath> {
  return checked(filePath, root, {
    code: 'invalid-arguments',
    message: 'Repo root must be a directory path.',
    recovery: 'Run render:png from a Novakai Canvas checkout.',
  });
}

/** `all` when the --labels switch is given: hidden wire labels are drawn too. Otherwise `default`. */
function labelMode(raw: RenderArguments): LabelMode {
  if (raw.values.get('labels') === true) return 'all';
  return 'default';
}

/** A text flag's value as given; absent when the flag is not given. */
function flagText(
  raw: RenderArguments,
  flag: TextFlag,
): string | undefined {
  const value = raw.values.get(flag);
  if (typeof value !== 'string') return undefined;
  return value;
}

/** Whether --collection text names a `.canvas` file. */
function isCanvasFile(text: string | undefined): boolean {
  return text?.endsWith('.canvas') === true;
}

/** Whether `text` is svg or png. */
function isRenderFormat(text: string): text is RenderFormat {
  return Object.hasOwn(renderFormats, text);
}

/** A flag the render needs is absent or empty. */
function required(flag: string): FailureInput {
  return { code: 'invalid-arguments', message: `${flag} is required`, recovery: renderUsage };
}

/** An optional flag is given with no text. */
function empty(flag: string): FailureInput {
  return { code: 'invalid-arguments', message: `${flag} must not be empty`, recovery: renderUsage };
}

/** A refused flag, an operand or a malformed value; nothing was read or made. */
function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message, recovery: renderUsage });
}
