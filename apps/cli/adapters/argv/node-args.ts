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

/** What Node's parser hands back: the plain words, each flag's value, and every token in order. */
interface NodeReading {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly tokens: readonly Token[];
}

/** One flag the program has, and the text or switch value Node read for it. */
type DeclaredEntry<F extends string> = [F, string | boolean];

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
  const nodeReading = readWithNode(argv, knownFlags);
  const refused = firstRefusedFlag(nodeReading.tokens, knownFlags);
  if (refused !== undefined) {
    return malformedFlagFailure(refused);
  }
  return splitArguments(nodeReading, knownFlags);
}

/**
 * Reads argv with Node's parser in lenient mode (`strict: false`), so nothing is refused yet.
 * `firstRefusedFlag` then does strict mode's checks itself, so it can name the bad flag as typed.
 */
function readWithNode<F extends string>(
  argv: readonly string[],
  knownFlags: FlagSpec<F>,
): NodeReading {
  return parseArgs({
    args: [...argv],
    options: { ...knownFlags },
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
}

/** Finds the first flag Node's strict mode would refuse, or `undefined` when every flag is fine. */
function firstRefusedFlag<F extends string>(
  tokens: readonly Token[],
  knownFlags: FlagSpec<F>,
): FlagToken | undefined {
  const flagTokens = tokens.filter(isFlagToken);
  return flagTokens.find((token) => isRefusedFlag(token, knownFlags));
}

/** Whether the token is a flag, not a word or the `--` terminator. */
function isFlagToken(token: Token): token is FlagToken {
  return token.kind === 'option';
}

/** Whether strict mode would refuse the flag: the program doesn't have it, or its value misfits. */
function isRefusedFlag<F extends string>(
  token: FlagToken,
  knownFlags: FlagSpec<F>,
): boolean {
  if (!isFlag(token.name, knownFlags)) {
    return true;
  }
  const shape = knownFlags[token.name];
  return !hasFittingValue(token, shape);
}

/** Whether `name` is one of `knownFlags`; inherited keys such as `constructor` are not. */
function isFlag<F extends string>(
  name: string,
  knownFlags: FlagSpec<F>,
): name is F {
  return Object.hasOwn(knownFlags, name);
}

/** Whether the flag carries the value its shape takes: text for a text flag, none for a switch. */
function hasFittingValue(
  token: FlagToken,
  shape: FlagShape,
): boolean {
  const fitsShape = valueFits[shape.type];
  return fitsShape(token);
}

/** Whether a text flag has its text: after `=`, or as the next word if that isn't flag-like. */
function hasTextValue(token: FlagToken): boolean {
  if (token.value === undefined) {
    return false;
  }
  if (token.inlineValue === true) {
    return true;
  }
  return !isFlagLike(token.value);
}

/** Whether a word reads as a flag: `-` then at least one more character. A lone `-` is a value. */
function isFlagLike(word: string): boolean {
  return word.length > 1 && word.startsWith('-');
}

/** Whether a switch was typed without a value, as a switch must be. */
function hasNoValue(token: FlagToken): boolean {
  return token.value === undefined;
}

/** Makes the `malformed` reading, naming the refused flag as it was typed, such as `--nope`. */
function malformedFlagFailure<F extends string>(refused: FlagToken): ArgvReading<F> {
  return { kind: 'malformed', flag: refused.rawName };
}

/** Makes the `split` reading: the words, each known flag's value, and the flags typed twice. */
function splitArguments<F extends string>(
  nodeReading: NodeReading,
  knownFlags: FlagSpec<F>,
): ArgvReading<F> {
  const flagValues = declaredFlagValues(nodeReading.values, knownFlags);
  const repeated = repeatedFlags(nodeReading.tokens, knownFlags);
  const rawArguments: RawArguments<F> = {
    positionals: nodeReading.positionals,
    values: flagValues,
    repeated,
  };
  return { kind: 'split', arguments: rawArguments };
}

/** Keeps each flag the program has, with its text or switch value, and drops anything else. */
function declaredFlagValues<F extends string>(
  nodeValues: Readonly<Record<string, unknown>>,
  knownFlags: FlagSpec<F>,
): ReadonlyMap<F, string | boolean> {
  const allEntries = Object.entries(nodeValues);
  const declaredEntries = allEntries.filter((entry) => isDeclaredEntry(entry, knownFlags));
  return new Map(declaredEntries);
}

/** Whether the entry is a flag the program has, with a text or switch value. */
function isDeclaredEntry<F extends string>(
  entry: readonly [string, unknown],
  knownFlags: FlagSpec<F>,
): entry is DeclaredEntry<F> {
  const [name, nodeValue] = entry;
  return isFlag(name, knownFlags) && isFlagValue(nodeValue);
}

/** Whether Node gave a text or switch value; `parseArgs` gives nothing else without `multiple`. */
function isFlagValue(nodeValue: unknown): nodeValue is string | boolean {
  return typeof nodeValue === 'string' || typeof nodeValue === 'boolean';
}

/** Lists each flag typed more than once, named once, in the order it was first repeated. */
function repeatedFlags<F extends string>(
  tokens: readonly Token[],
  knownFlags: FlagSpec<F>,
): readonly F[] {
  const typedFlags = declaredFlagNames(tokens, knownFlags);
  const repeats = typedFlags.filter((flag, position) =>
    wasTypedEarlier(typedFlags, flag, position),
  );
  const uniqueRepeats = new Set(repeats);
  return [...uniqueRepeats];
}

/** Lists the typed flags the program has, in typed order, once for each time typed. */
function declaredFlagNames<F extends string>(
  tokens: readonly Token[],
  knownFlags: FlagSpec<F>,
): readonly F[] {
  const flagTokens = tokens.filter(isFlagToken);
  const typedNames = flagTokens.map(flagName);
  return typedNames.filter((name) => isFlag(name, knownFlags));
}

/** Gives the flag's name as Node read it, without dashes. */
function flagName(token: FlagToken): string {
  return token.name;
}

/** Whether `flag`, typed at `position` in the list, was already typed before it. */
function wasTypedEarlier<F extends string>(
  typedFlags: readonly F[],
  flag: F,
  position: number,
): boolean {
  const firstPosition = typedFlags.indexOf(flag);
  return firstPosition < position;
}
