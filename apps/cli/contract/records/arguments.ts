/*
 * Why this file exists
 *
 * Node can split a typed line into words and flags, but only if it is told which flags exist and
 * which ones take text. In `pnpm canvas read my-diagram --section intro`, Node must know that
 * `--section` takes the word after it, so `intro` isn't read as another word.
 *
 * This file lists the flags of both programs, `pnpm canvas` and `pnpm render:png`, and names what
 * Node hands back: the words, the text after each flag, and any flag typed twice. It never checks
 * what the words mean; `core/commands/parse.ts` does that.
 */

/** Every flag `pnpm canvas` has, such as `--server` or `--revision`, without the dashes. */
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

/** Every flag `pnpm render:png` has, without the dashes. */
export type RenderFlag = 'collection' | 'theme' | 'theme-file' | 'out' | 'format' | 'labels';

/**
 * How Node reads one flag: `string` takes the text after it, `boolean` stands alone (a switch).
 * `short` is an optional one-letter name, such as `-h` for `--help`.
 */
export interface FlagShape {
  readonly type: 'string' | 'boolean';
  readonly short?: string;
}

/** How Node reads each flag of one program. A missing or extra flag doesn't compile. */
export type FlagSpec<F extends string> = Readonly<Record<F, FlagShape>>;

/** A flag that takes text. Frozen, like every shape in `canvasFlags` and `renderFlags`. */
const textFlag: FlagShape = Object.freeze({ type: 'string' });

/** How Node reads `pnpm canvas`'s flags. Only `--help` (`-h`) stands alone; the rest take text. */
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

/** How Node reads `pnpm render:png`'s flags. Only `--labels` stands alone; the rest take text. */
export const renderFlags: FlagSpec<RenderFlag> = Object.freeze({
  collection: textFlag,
  theme: textFlag,
  'theme-file': textFlag,
  out: textFlag,
  format: textFlag,
  labels: Object.freeze({ type: 'boolean' }),
} satisfies FlagSpec<RenderFlag>);

/** The words and flags Node read from a typed line, not checked yet. */
export interface RawArguments<F extends string> {
  /** The words that aren't flags, in order: `['read', 'my-diagram']`. */
  readonly positionals: readonly string[];
  /** The text typed after each flag, or `true` for a switch. A repeated flag keeps its last. */
  readonly values: ReadonlyMap<F, string | boolean>;
  /** Each flag typed more than once, named once. */
  readonly repeated: readonly F[];
}

/**
 * What Node made of a typed line: `read`, with its words and flags, or `malformed`, when a flag
 * couldn't be read. `flag` is that flag as typed, such as `--nope` or `--out` with no text.
 */
export type ArgvReading<F extends string> =
  | { readonly kind: 'read'; readonly arguments: RawArguments<F> }
  | { readonly kind: 'malformed'; readonly flag: string };

/**
 * A typed `pnpm canvas` line, after Node has split it into words and flags. It is either `read`,
 * holding the words and flags, or `malformed`, when a flag couldn't be read (a flag the CLI
 * doesn't have, or one missing its value).
 */
export type CommandLine = ArgvReading<CanvasFlag>;
