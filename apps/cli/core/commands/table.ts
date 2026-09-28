/*
 * The `pnpm canvas` command table: one frozen row per command with the flags it accepts and its
 * `--help` lines, and the commands that take no operand. Pure data plus lookups. The grammar
 * (`parse.ts`, `placement.ts`) and the help text (`help.ts`) read it, so a command's words,
 * operand, flags and usage live in one place.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { TextFlag } from './flags.js';

/** A word that joins the next word into one command name: `recipe admit` → `recipe-admit`. */
export type FamilyWord = 'theme' | 'recipe' | 'profile';

/** A command that takes no operand: `help`, `describe` or `list`. */
export type NoOperandCommand = 'help' | 'describe' | 'list';

/** A command that takes one operand: an ID, a FILE, a profile or a recipe pin. */
export type OneOperandCommand = Exclude<CommandName, NoOperandCommand>;

/** One command's grammar and help. */
export interface CommandRow {
  /** Every flag this command takes; giving it any other flag is `invalid-arguments`. */
  readonly accepted: readonly TextFlag[];
  /** Its lines in `canvas --help`, verbatim and in order; the table's order is the help order. */
  readonly usage: readonly string[];
}

/** Where a service command is sent: --server and --workspace. */
const sent: readonly TextFlag[] = Object.freeze(['server', 'workspace']);

/** A service command whose text answer --out may write. */
const answered: readonly TextFlag[] = Object.freeze(['out', ...sent]);

/** A service command that retains its request under --request. */
const retained: readonly TextFlag[] = Object.freeze(['request', ...answered]);

/**
 * `--help` added to a real command line still prints usage, as in the base CLI: help takes and
 * ignores every flag but the five placed ones (--profile, --id, --title, --section, --object).
 */
const besideHelp: readonly TextFlag[] = Object.freeze([
  'revision',
  'mode',
  'namespace',
  'version',
  'family',
  ...retained,
]);

/** Every command, in `--help` order: a missing, extra or misspelt name is a type error. */
const commandTable: Readonly<Record<CommandName, CommandRow>> = Object.freeze({
  help: row({ accepted: besideHelp, usage: [] }),
  describe: row({
    accepted: answered,
    usage: ['canvas describe                         Read the DSL vocabulary'],
  }),
  list: row({
    accepted: answered,
    usage: ['canvas list                             List collection IDs and revisions'],
  }),
  read: row({
    accepted: ['section', 'object', ...answered],
    usage: [
      'canvas read ID [--section ID | --object ID] [--out FILE]',
      '                                        Read full or read-only partial context',
    ],
  }),
  inspect: row({
    accepted: answered,
    usage: [
      'canvas inspect ID                        Scene quality report: validity, warnings, crossing/relaxed counts',
    ],
  }),
  create: row({
    accepted: retained,
    usage: ['canvas create FILE                      Create a collection from DSL'],
  }),
  replace: row({
    accepted: ['revision', ...retained],
    usage: ['canvas replace FILE --revision N        Replace semantics at the revision you read'],
  }),
  patch: row({
    accepted: ['revision', ...retained],
    usage: ['canvas patch FILE --revision N          Apply an ordered DSL patch'],
  }),
  preview: row({
    accepted: ['mode', 'revision', ...retained],
    usage: [
      'canvas preview FILE [--mode MODE]        Preview; use --revision N for existing collections',
    ],
  }),
  'theme-admit': row({
    accepted: retained,
    usage: ['canvas theme admit FILE                 Admit a semantic theme config'],
  }),
  'recipe-admit': row({
    accepted: ['id', 'version', 'family', 'title', ...retained],
    usage: ['canvas recipe admit FILE                Requires --id --version --family --title'],
  }),
  'recipe-instantiate': row({
    accepted: ['namespace', ...answered],
    usage: [
      'canvas recipe instantiate PIN           Requires --namespace ID; --out FILE emits editable DSL',
    ],
  }),
  apply: row({
    accepted: answered,
    usage: ['canvas apply REQUEST_ID                 Apply a retained preview'],
  }),
  receipt: row({
    accepted: answered,
    usage: ['canvas receipt REQUEST_ID               Check a committed receipt'],
  }),
  retry: row({
    accepted: answered,
    usage: [
      'canvas retry REQUEST_ID                 Reconcile, then retry the identical retained request',
    ],
  }),
  'profile-describe': row({
    accepted: ['out'],
    usage: ['canvas profile describe build-spec@1    Show the build-spec conventions'],
  }),
  'profile-scaffold': row({
    accepted: ['id', 'title', 'out'],
    usage: ['canvas profile scaffold build-spec@1 --id ID --title "Title" [--out FILE]'],
  }),
  'profile-lint': row({
    accepted: ['profile', 'out'],
    usage: ['canvas profile lint FILE --profile build-spec@1'],
  }),
} satisfies Record<CommandName, CommandRow>);

/** Every command that takes no operand, keyed by itself. */
const noOperandCommands: Readonly<Record<NoOperandCommand, NoOperandCommand>> = Object.freeze({
  help: 'help',
  describe: 'describe',
  list: 'list',
} satisfies Record<NoOperandCommand, NoOperandCommand>);

/** Every family word, keyed by itself. */
const familyWords: Readonly<Record<FamilyWord, FamilyWord>> = Object.freeze({
  theme: 'theme',
  recipe: 'recipe',
  profile: 'profile',
} satisfies Record<FamilyWord, FamilyWord>);

/**
 * Whether `word` names a command. A missing word does not, and neither does an inherited object
 * key such as `constructor`.
 */
export function isCommandName(word: string | undefined): word is CommandName {
  return word !== undefined && Object.hasOwn(commandTable, word);
}

/** Whether `word` joins the next word into one command name. A missing word does not. */
export function isFamilyWord(word: string | undefined): word is FamilyWord {
  return word !== undefined && Object.hasOwn(familyWords, word);
}

/** Whether the command takes no operand; every other command takes exactly one. */
export function takesNoOperand(name: CommandName): name is NoOperandCommand {
  return Object.hasOwn(noOperandCommands, name);
}

/** Whether the command accepts `flag`. */
export function isAccepted(
  name: CommandName,
  flag: TextFlag,
): boolean {
  return commandTable[name].accepted.includes(flag);
}

/** The command as typed: a family command's two words, such as `recipe admit`. */
export function typedName(name: CommandName): string {
  const [family, ...memberWords] = name.split('-');
  if (!isFamilyWord(family)) {
    return name;
  }
  const member = memberWords.join('-');
  return `${family} ${member}`;
}

/** Every row, in `--help` order. */
export function commandRows(): readonly CommandRow[] {
  return Object.values(commandTable);
}

/** `spec` frozen with its flags and usage lines, so no reader can change a row. */
function row(spec: CommandRow): CommandRow {
  return Object.freeze({
    accepted: Object.freeze([...spec.accepted]),
    usage: Object.freeze([...spec.usage]),
  });
}
