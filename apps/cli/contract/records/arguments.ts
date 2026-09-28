/*
 * Argv as Node's parser reads it, before any command rule: the flags `pnpm canvas` and
 * `pnpm render:png` declare, and the words, flag values and repeated flags the argv adapter found.
 * Pure declarations. Core's grammars (`core/commands/parse.ts`, `core/render/request.ts`) check
 * every word and value.
 */

/** Every `pnpm canvas` flag. */
export type CanvasFlag =
  | 'help'
  | 'server'
  | 'workspace'
  | 'revision'
  | 'mode'
  | 'request'
  | 'out'
  | 'id'
  | 'version'
  | 'family'
  | 'title'
  | 'namespace'
  | 'profile'
  | 'section'
  | 'object';

/** Every `pnpm render:png` flag. */
export type RenderFlag = 'collection' | 'theme' | 'theme-file' | 'out' | 'format' | 'labels';

/** How Node parses one flag: a text value or a switch, with an optional one-letter alias. */
export interface FlagShape {
  readonly type: 'string' | 'boolean';
  readonly short?: string;
}

/** One executable's flags: a missing or extra flag is a type error. */
export type FlagSpec<F extends string> = Readonly<Record<F, FlagShape>>;

/** A flag that takes text. Frozen, like every shape in `canvasFlags` and `renderFlags`. */
const textFlag: FlagShape = Object.freeze({ type: 'string' });

/** `pnpm canvas` flags. Only `--help` (`-h`) is a switch. No flag has a default here; core fills them. */
export const canvasFlags: FlagSpec<CanvasFlag> = Object.freeze({
  help: Object.freeze({ type: 'boolean', short: 'h' }),
  server: textFlag,
  workspace: textFlag,
  revision: textFlag,
  mode: textFlag,
  request: textFlag,
  out: textFlag,
  id: textFlag,
  version: textFlag,
  family: textFlag,
  title: textFlag,
  namespace: textFlag,
  profile: textFlag,
  section: textFlag,
  object: textFlag,
} satisfies FlagSpec<CanvasFlag>);

/** `pnpm render:png` flags. Only `--labels` is a switch. No flag has a default here; core fills them. */
export const renderFlags: FlagSpec<RenderFlag> = Object.freeze({
  collection: textFlag,
  theme: textFlag,
  'theme-file': textFlag,
  out: textFlag,
  format: textFlag,
  labels: Object.freeze({ type: 'boolean' }),
} satisfies FlagSpec<RenderFlag>);

/** The words and flags Node accepted. */
export interface RawArguments<F extends string> {
  /** Every word that is not a flag, in order. */
  readonly positionals: readonly string[];
  /** Each flag given, by name: text for a text flag, `true` for a switch. A flag given twice keeps its last value. */
  readonly values: ReadonlyMap<F, string | boolean>;
  /** Each flag given more than once, named once. */
  readonly repeated: readonly F[];
}

/**
 * What the argv adapter read. `malformed`: a flag Node's strict mode refuses (an unknown flag, a
 * text flag with no value, a value on a switch), named in `flag` as typed, such as `--nope` or
 * `-c`; core reports it as `invalid-arguments`.
 */
export type ArgvReading<F extends string> =
  | { readonly kind: 'read'; readonly arguments: RawArguments<F> }
  | { readonly kind: 'malformed'; readonly flag: string };

/**
 * A typed `pnpm canvas` line, after Node has split it into words and flags. It is either `read`,
 * holding the words and flags, or `malformed`, when a flag couldn't be read (a flag the CLI
 * doesn't have, or one missing its value).
 */
export type CanvasArgv = ArgvReading<CanvasFlag>;
