/*
 * The `pnpm canvas` command table: one frozen row per command with its operand count, the placed
 * flags it takes and its `--help` lines. Pure data plus lookups. The grammar (`parse.ts`) and the
 * help text (`help.ts`) read it, so a command's words, operands and usage live in one place.
 */
import type { CommandName } from '../../contract/records/command.js';

/** A word that joins the next word into one command name: `recipe admit` → `recipe-admit`. */
export type FamilyWord = 'theme' | 'recipe' | 'profile';

/**
 * Flags only some commands take; giving one to another command is `invalid-arguments`. Every
 * other flag is accepted by every command.
 */
export type PlacedFlag = 'profile' | 'id' | 'title' | 'section' | 'object';

/** One command's grammar and help. */
export interface CommandRow {
  /** Operands after the command words. */
  readonly operands: 0 | 1;
  /** The placed flags this command takes. */
  readonly placed: readonly PlacedFlag[];
  /** Its lines in `canvas --help`, verbatim and in order; the table's order is the help order. */
  readonly usage: readonly string[];
}

/** Every command, in `--help` order: a missing, extra or misspelt name is a type error. */
const commandTable: Readonly<Record<CommandName, CommandRow>> = Object.freeze({
  help: { operands: 0, placed: [], usage: [] },
  describe: {
    operands: 0,
    placed: [],
    usage: ['canvas describe                         Read the DSL vocabulary'],
  },
  list: {
    operands: 0,
    placed: [],
    usage: ['canvas list                             List collection IDs and revisions'],
  },
  read: {
    operands: 1,
    placed: ['section', 'object'],
    usage: [
      'canvas read ID [--section ID | --object ID] [--out FILE]',
      '                                        Read full or read-only partial context',
    ],
  },
  inspect: {
    operands: 1,
    placed: [],
    usage: [
      'canvas inspect ID                        Scene quality report: validity, warnings, crossing/relaxed counts',
    ],
  },
  create: {
    operands: 1,
    placed: [],
    usage: ['canvas create FILE                      Create a collection from DSL'],
  },
  replace: {
    operands: 1,
    placed: [],
    usage: ['canvas replace FILE --revision N        Replace semantics at the revision you read'],
  },
  patch: {
    operands: 1,
    placed: [],
    usage: ['canvas patch FILE --revision N          Apply an ordered DSL patch'],
  },
  preview: {
    operands: 1,
    placed: [],
    usage: [
      'canvas preview FILE [--mode MODE]        Preview; use --revision N for existing collections',
    ],
  },
  'theme-admit': {
    operands: 1,
    placed: [],
    usage: ['canvas theme admit FILE                 Admit a semantic theme config'],
  },
  'recipe-admit': {
    operands: 1,
    placed: ['id', 'title'],
    usage: ['canvas recipe admit FILE                Requires --id --version --family --title'],
  },
  'recipe-instantiate': {
    operands: 1,
    placed: [],
    usage: [
      'canvas recipe instantiate PIN           Requires --namespace ID; --out FILE emits editable DSL',
    ],
  },
  apply: {
    operands: 1,
    placed: [],
    usage: ['canvas apply REQUEST_ID                 Apply a retained preview'],
  },
  receipt: {
    operands: 1,
    placed: [],
    usage: ['canvas receipt REQUEST_ID               Check a committed receipt'],
  },
  retry: {
    operands: 1,
    placed: [],
    usage: [
      'canvas retry REQUEST_ID                 Reconcile, then retry the identical retained request',
    ],
  },
  'profile-describe': {
    operands: 1,
    placed: [],
    usage: ['canvas profile describe build-spec@1    Show the build-spec conventions'],
  },
  'profile-scaffold': {
    operands: 1,
    placed: ['id', 'title'],
    usage: ['canvas profile scaffold build-spec@1 --id ID --title "Title" [--out FILE]'],
  },
  'profile-lint': {
    operands: 1,
    placed: ['profile'],
    usage: ['canvas profile lint FILE --profile build-spec@1'],
  },
} satisfies Record<CommandName, CommandRow>);

/** Every family word, keyed by itself. */
const familyWords: Readonly<Record<FamilyWord, FamilyWord>> = Object.freeze({
  theme: 'theme',
  recipe: 'recipe',
  profile: 'profile',
} satisfies Record<FamilyWord, FamilyWord>);

/** Whether `word` names a command; inherited object keys such as `constructor` do not. */
export function isCommandName(word: string): word is CommandName {
  return Object.hasOwn(commandTable, word);
}

/** Whether `word` joins the next word into one command name. */
export function isFamilyWord(word: string): word is FamilyWord {
  return Object.hasOwn(familyWords, word);
}

/** The command's row. */
export function commandRow(name: CommandName): CommandRow {
  return commandTable[name];
}

/** Every row, in `--help` order. */
export function commandRows(): readonly CommandRow[] {
  return Object.values(commandTable);
}
