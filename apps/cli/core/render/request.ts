/*
 * `pnpm render:png` argv → RenderChoice, checked in the base render's order: Node accepted the
 * flags; no operand; --collection; --out; --format; --theme; --theme-file. Pure. Every failure is
 * `invalid-arguments` and comes before any file is read or any temporary store is made: the caller
 * corrects the named flag and runs render:png again.
 */
import type { ArgvReading, RawArguments, RenderFlag } from '../../contract/records/arguments.js';
import type {
  CollectionSelector,
  LabelMode,
  RenderChoice,
  RenderFormat,
} from '../../contract/records/render.js';
import { collectionName, filePath, themeName } from '../../contract/brands.js';
import type { CollectionName, FilePath } from '../../contract/brands.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../shared/checks.js';
import { joined, mapped } from '../shared/results.js';
import { flagName, formatNames, isRenderFormat, renderUsage } from './flags.js';
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
 * The render `reading` asks for. --labels cannot fail. Fails with `invalid-arguments`, naming the
 * flag or word: a flag Node refused (unknown, a text flag with no value, a value on --labels), any
 * operand, a missing or empty --collection or --out, a --format other than svg or png, or an empty
 * --theme or --theme-file.
 */
export function parseRenderChoice(reading: ArgvReading<RenderFlag>): Result<RenderChoice> {
  if (reading.kind === 'malformed')
    return failure(refusal(`Unknown or malformed flag: ${reading.flag}`));
  return flagsOnly(reading.arguments);
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
  return mapped(checked(collectionName, text, absent), namedCollection);
}

/** --out, as given. Fails with `invalid-arguments` when absent or empty. */
function outputDirectory(raw: RenderArguments): Result<FilePath> {
  return checked(filePath, flagText(raw, 'out'), required('out'));
}

/** --format: svg or png; png when absent. Fails with `invalid-arguments`. */
function sectionFormat(raw: RenderArguments): Result<RenderFormat> {
  const text = flagText(raw, 'format') ?? defaultFormat;
  if (!isRenderFormat(text))
    return failure(refusal(`${flagName('format')} must be ${formatNames.join(' or ')}`));
  return success(text);
}

/** --theme, then --theme-file; an absent one stays absent. Fails with `invalid-arguments`. */
function themeChoice(raw: RenderArguments): Result<Pick<RenderChoice, 'theme' | 'themeFile'>> {
  return joined(
    optionalText(raw, 'theme', themeName, (theme) => ({ theme })),
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
function namedCollection(name: CollectionName): CollectionSelector {
  return { kind: 'named', name };
}

/** A flag the render needs is absent or empty. */
function required(flag: RequiredFlag): FailureInput {
  return refusal(`${flagName(flag)} is required`);
}

/** An optional flag is given with no text. */
function empty(flag: OptionalTextFlag): FailureInput {
  return refusal(`${flagName(flag)} must not be empty`);
}

/** A refused flag, operand or value, followed by the usage line; nothing was read or made. */
function refusal(message: string): FailureInput {
  return { code: 'invalid-arguments', message, recovery: renderUsage };
}
