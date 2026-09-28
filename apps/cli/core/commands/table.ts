/*
 * Why this file exists
 *
 * Several parts of the CLI need the same facts about each command. Parsing needs to know
 * that `read` accepts `--section`. `--help` needs the line that shows how to type `read`. If each
 * part kept its own list, the lists would drift apart.
 *
 * This file keeps one row per command, with the flags it accepts and its `--help` lines. It also
 * lists the commands typed with no word after them (`help`, `describe`, `list`), and the command
 * groups: `theme`, `recipe` and `profile`, the words that start a two-word command.
 *
 * The word typed after a command is its operand: `my-diagram` in `read my-diagram`. A command takes
 * no operand or exactly one.
 *
 * It holds data and simple lookups only. The rows are frozen, so nothing can change them while the
 * CLI runs.
 */
import type { CommandName } from '../../contract/records/command.js';
import type { TextFlag } from './flags.js';

/**
 * A word that starts a two-word command. `recipe` starts `recipe admit` and `recipe instantiate`,
 * which the CLI names `recipe-admit` and `recipe-instantiate`.
 */
export type CommandGroup = 'theme' | 'recipe' | 'profile';

/** A command typed with no word after it: `help`, `describe` or `list`. */
export type NoOperandCommand = 'help' | 'describe' | 'list';

/**
 * A command typed with one word after it: a collection ID (`read my-diagram`), a file, a request
 * ID, a profile, or a recipe pin (the exact recipe, such as `er@1.0.0#sha256:DIGEST`).
 */
export type OneOperandCommand = Exclude<CommandName, NoOperandCommand>;

/** How many words a command takes after it: 0 (`list`) or 1 (`read my-diagram`). */
export type OperandCount = 0 | 1;

/**
 * One command's row: the flags it accepts, and its lines in `--help`. The table keys each row by
 * its command's name, so the row itself holds no name.
 */
export interface CommandRow {
  /** Every flag the command accepts. Typing any other flag with it is a mistake. */
  readonly accepted: readonly TextFlag[];
  /** Its lines in `--help`, exactly as printed. `--help` lists the rows in the table's order. */
  readonly usage: readonly string[];
}

/** Where a service command is sent: --server and --workspace. */
const sent: readonly TextFlag[] = Object.freeze(['server', 'workspace']);

/** A service command whose text answer --out may write. */
const answered: readonly TextFlag[] = Object.freeze(['out', ...sent]);

/** A service command that retains its request under --request. */
const retained: readonly TextFlag[] = Object.freeze(['request', ...answered]);

/**
 * `--help` added to a real command line still prints usage: `help` accepts and ignores every flag
 * but five (--profile, --id, --title, --section, --object).
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

/** Every word that starts a two-word command, keyed by itself. */
const commandGroups: Readonly<Record<CommandGroup, CommandGroup>> = Object.freeze({
  theme: 'theme',
  recipe: 'recipe',
  profile: 'profile',
} satisfies Record<CommandGroup, CommandGroup>);

/** Whether the word names a command, such as `read` or `recipe-admit`. A missing word doesn't. */
export function isCommandName(word: string | undefined): word is CommandName {
  // `hasOwn`, so `constructor`, which every JavaScript object has, isn't taken for a command.
  return word !== undefined && Object.hasOwn(commandTable, word);
}

/** Whether the word starts a two-word command: `theme`, `recipe` or `profile`. */
export function isCommandGroup(word: string | undefined): word is CommandGroup {
  return word !== undefined && Object.hasOwn(commandGroups, word);
}

/** Whether the command is typed with no word after it. Every other command takes exactly one. */
export function takesNoOperand(name: CommandName): name is NoOperandCommand {
  return Object.hasOwn(noOperandCommands, name);
}

/** Whether the command accepts the flag: yes for `read --section`, no for `list --revision`. */
export function acceptsFlag(
  name: CommandName,
  flag: TextFlag,
): boolean {
  return commandTable[name].accepted.includes(flag);
}

/** The command the way an agent types it: `recipe-admit` is typed `recipe admit`. */
export function commandAsTyped(name: CommandName): string {
  const [group, ...memberWords] = name.split('-');
  if (!isCommandGroup(group)) {
    return name;
  }
  const member = memberWords.join('-');
  return `${group} ${member}`;
}

/** Every command's row, in the order `--help` lists them. */
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
