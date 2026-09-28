/*
 * Why this file exists
 *
 * `pnpm canvas` and `pnpm render:png` both start from the words Node hands over (argv), such as
 * `['read', 'my-diagram', '--section', 'intro']`. Those must be split into plain words and flags,
 * and a flag that can't be read, such as `--nope` or `--out` with nothing after it, must be caught.
 *
 * This file does that split with Node's own parser, for whichever flags a program has. It never
 * decides what the words mean: core works out the command and checks every value.
 */
import { parseArgs } from 'node:util';
import type {
  ArgvReading,
  FlagShape,
  FlagSpec,
  RawArguments,
} from '../../contract/records/arguments.js';

/** One argv token from Node's parser: a flag, a word or the `--` terminator. */
type Token = FlagToken | { readonly kind: 'positional' | 'option-terminator' };

/** A flag as Node read it. `inlineValue` is true when the value followed `=` in the same word. */
interface FlagToken {
  readonly kind: 'option';
  readonly name: string;
  /** The flag as typed, such as `--out` or `-h`, without any `=value`. */
  readonly rawName: string;
  readonly value: string | undefined;
  readonly inlineValue: boolean | undefined;
}

/** Whether a flag token carries the value one flag shape takes. */
type ValueCheck = (token: FlagToken) => boolean;

/** Each flag shape's value check: a text flag needs a value, a switch takes none. */
const valueFits: Readonly<Record<FlagShape['type'], ValueCheck>> = Object.freeze({
  string: hasTextValue,
  boolean: hasNoValue,
});

/**
 * Splits argv into its plain words, the text after each flag, and the flags typed more than once.
 * `knownFlags` lists the program's flags and whether each takes text or is a switch (takes none).
 * Gives back `malformed`, naming the first bad flag as typed: a flag the program doesn't have, a
 * flag missing its text (a next word starting with `-` isn't text), or a switch given text.
 */
export function readArguments<F extends string>(
  argv: readonly string[],
  knownFlags: FlagSpec<F>,
): ArgvReading<F> {
  const parsed = parseArgs({
    args: [...argv],
    options: { ...knownFlags },
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
  const refused = refusedFlag(parsed.tokens, knownFlags);
  if (refused !== undefined) return { kind: 'malformed', flag: refused.rawName };
  return { kind: 'split', arguments: rawArguments(parsed, knownFlags) };
}

/** The first flag token Node's strict mode would refuse; absent when every flag is accepted. */
function refusedFlag<F extends string>(
  tokens: readonly Token[],
  spec: FlagSpec<F>,
): FlagToken | undefined {
  return tokens.filter(isFlagToken).find((token) => !isAccepted(token, spec));
}

/** Node's answer, keeping only values of declared flags. */
function rawArguments<F extends string>(
  parsed: {
    readonly positionals: readonly string[];
    readonly values: Readonly<Record<string, unknown>>;
    readonly tokens: readonly Token[];
  },
  spec: FlagSpec<F>,
): RawArguments<F> {
  return {
    positionals: parsed.positionals,
    values: declaredValues(parsed.values, spec),
    repeated: repeatedFlags(parsed.tokens, spec),
  };
}

/** Each declared flag's text or switch value; anything else is dropped. */
function declaredValues<F extends string>(
  values: Readonly<Record<string, unknown>>,
  spec: FlagSpec<F>,
): ReadonlyMap<F, string | boolean> {
  const entries = Object.entries(values).filter(
    (entry): entry is [F, string | boolean] => isFlag(entry[0], spec) && isFlagValue(entry[1]),
  );
  return new Map(entries);
}

/** Each flag whose token appears more than once, named once, in first-repeat order. */
function repeatedFlags<F extends string>(
  tokens: readonly Token[],
  spec: FlagSpec<F>,
): readonly F[] {
  const names = tokens.filter(isFlagToken).flatMap((token) => declared(token.name, spec));
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

/** Whether the token is a flag, not a word or the `--` terminator. */
function isFlagToken(token: Token): token is FlagToken {
  return token.kind === 'option';
}

/** Whether `spec` declares the flag and the token carries the value its shape takes. */
function isAccepted<F extends string>(
  token: FlagToken,
  spec: FlagSpec<F>,
): boolean {
  if (!isFlag(token.name, spec)) return false;
  return valueFits[spec[token.name].type](token);
}

/** A text flag has a value: after `=`, or as the next word unless that word looks like a flag. */
function hasTextValue(token: FlagToken): boolean {
  if (token.value === undefined) return false;
  return token.inlineValue === true || !isFlagLike(token.value);
}

/** A switch has no value. */
function hasNoValue(token: FlagToken): boolean {
  return token.value === undefined;
}

/** Whether a word reads as a flag: `-` then at least one more character. A lone `-` is a value. */
function isFlagLike(word: string): boolean {
  return word.length > 1 && word.startsWith('-');
}

/** `[name]` when `spec` declares it; otherwise nothing. */
function declared<F extends string>(
  name: string,
  spec: FlagSpec<F>,
): readonly F[] {
  if (!isFlag(name, spec)) return [];
  return [name];
}

/** Whether `name` is declared in `spec`; inherited object keys such as `constructor` are not. */
function isFlag<F extends string>(
  name: string,
  spec: FlagSpec<F>,
): name is F {
  return Object.hasOwn(spec, name);
}

/** Whether Node gave a text or switch value; `parseArgs` gives nothing else without `multiple`. */
function isFlagValue(value: unknown): value is string | boolean {
  return typeof value === 'string' || typeof value === 'boolean';
}
