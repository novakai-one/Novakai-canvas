/*
 * Argv → RawArguments with Node's `parseArgs`, for any executable's flag spec. Knows no command,
 * default or placement rule: core's grammar checks every word and value. Pure apart from Node's
 * parser; nothing is read or sent. A refused argv is `malformed`; the caller reports it.
 */
import { parseArgs } from 'node:util';
import type { ArgvReading, FlagSpec, RawArguments } from '../../contract/records/arguments.js';

/** One argv token from Node's parser; only a flag token's name is read. */
interface Token {
  readonly kind: string;
  readonly name?: string;
}

/**
 * The words, flag values and repeated flags in `argv`. Unknown flags are refused (strict mode).
 * Returns `malformed` when Node throws: an unknown flag, a text flag with no value, or a value on a
 * switch.
 */
export function readArguments<F extends string>(
  argv: readonly string[],
  spec: FlagSpec<F>,
): ArgvReading<F> {
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { ...spec },
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
    return { kind: 'read', arguments: rawArguments(parsed, spec) };
  } catch {
    return { kind: 'malformed' };
  }
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
function isFlagToken(token: Token): token is Token & { readonly name: string } {
  return token.kind === 'option' && token.name !== undefined;
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
