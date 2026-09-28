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
import type { RecipeOrCollectionId, FilePath } from '../../contract/brands.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../../contract/schemas.js';
import { joined, mapped } from '../shared/results.js';
import { flagAsTyped, formatNames, isRenderFormat, renderUsage } from './flags.js';
import type { OptionalFlag, RequiredFlag } from './flags.js';

/** The flags render:png read, as Node gave them. */
type RenderArguments = RawArguments<RenderFlag>;

/** A render:png flag that carries text: every flag but the `--labels` switch. */
type TextFlag = Exclude<RenderFlag, 'labels'>;

/** An optional flag that carries text. */
type OptionalTextFlag = Exclude<OptionalFlag, 'labels'>;

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
  if (typedLine.kind === 'malformed')
    return failure(refusal(`Unknown or malformed flag: ${typedLine.flag}`));
  return flagsOnly(typedLine.arguments);
}

/** Every word is refused: render:png takes flags only. Fails with `invalid-arguments`. */
function flagsOnly(raw: RenderArguments): Result<RenderChoice> {
  const [word] = raw.positionals;
  if (word !== undefined) return failure(refusal(`render:png takes no operands: ${word}`));
  return choice(raw);
}

/** --collection, --out, --format, then the theme flags; the first failure wins. */
function choice(raw: RenderArguments): Result<RenderChoice> {
  const target = joined(selector(raw), outputDirectory(raw), (collection, out) => ({
    collection,
    out,
  }));
  const formatted = joined(target, sectionFormat(raw), (fields, format) => ({ ...fields, format }));
  return joined(formatted, themeChoice(raw), (fields, themes) => ({
    ...fields,
    ...themes,
    labels: labelMode(raw),
  }));
}

/**
 * --collection. Text ending in `.canvas` is a file; any other text names a recipe or a shipped
 * collection. Fails with `invalid-arguments` when absent or empty.
 */
function selector(raw: RenderArguments): Result<CollectionSelector> {
  const text = flagText(raw, 'collection');
  const absent = required('collection');
  if (isCanvasFile(text)) return mapped(checked(filePath, text, absent), canvasFile);
  return mapped(checked(recipeOrCollectionId, text, absent), namedCollection);
}

/** --out, as given. Fails with `invalid-arguments` when absent or empty. */
function outputDirectory(raw: RenderArguments): Result<FilePath> {
  return checked(filePath, flagText(raw, 'out'), required('out'));
}

/** --format: svg or png; png when absent. Fails with `invalid-arguments`. */
function sectionFormat(raw: RenderArguments): Result<RenderFormat> {
  const text = flagText(raw, 'format') ?? defaultFormat;
  if (!isRenderFormat(text))
    return failure(refusal(`${flagAsTyped('format')} must be ${formatNames.join(' or ')}`));
  return success(text);
}

/** --theme, then --theme-file; an absent one stays absent. Fails with `invalid-arguments`. */
function themeChoice(raw: RenderArguments): Result<Pick<RenderChoice, 'theme' | 'themeFile'>> {
  return joined(
    optionalText(raw, 'theme', themeId, (theme) => ({ theme })),
    optionalText(raw, 'theme-file', filePath, (themeFile) => ({ themeFile })),
    (theme, themeFile) => ({ ...theme, ...themeFile }),
  );
}

/**
 * An optional text flag, minted by `parser` and placed under its field by `place`; absent stays
 * absent. Fails with `invalid-arguments` when empty.
 */
function optionalText<T, R extends object>(
  raw: RenderArguments,
  flag: OptionalTextFlag,
  parser: Parser<T>,
  place: (value: T) => R,
): Result<Partial<R>> {
  const text = flagText(raw, flag);
  if (text === undefined) return success({});
  return mapped(checked(parser, text, empty(flag)), place);
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
  if (text === undefined) return false;
  return text.endsWith('.canvas');
}

/** A `.canvas` file selector. */
function canvasFile(path: FilePath): CollectionSelector {
  return { kind: 'file', path };
}

/** A recipe or shipped collection selector. */
function namedCollection(name: RecipeOrCollectionId): CollectionSelector {
  return { kind: 'id', id: name };
}

/** A flag the render needs is absent or empty. */
function required(flag: RequiredFlag): FailureInput {
  return refusal(`${flagAsTyped(flag)} is required`);
}

/** An optional flag is given with no text. */
function empty(flag: OptionalTextFlag): FailureInput {
  return refusal(`${flagAsTyped(flag)} must not be empty`);
}

/** A refused flag, operand or value, followed by the usage line; nothing was read or made. */
function refusal(message: string): FailureInput {
  return { code: 'invalid-arguments', message, recovery: renderUsage };
}
