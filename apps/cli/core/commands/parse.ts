/*
 * `pnpm canvas` argv → ParsedCommand, checked in the base CLI's order: Node accepted the flags; no
 * read scope flag is repeated; `--help` or a known command word (a family word joins the next
 * word); the command's operand count; placed flags only where the command table takes them. Then
 * `operands.ts` checks each value. Pure. Every failure comes before anything is read or sent: the
 * caller corrects the named argument and runs the command again.
 */
import type { ArgvReading, CanvasFlag, RawArguments } from '../../contract/records/arguments.js';
import type { CommandName, ParsedCommand } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { flagText } from './flags.js';
import type { CommandDefaults, CommandFlags, CommandWords } from './flags.js';
import { assembleCommand } from './operands.js';
import { lintProfileRequired } from './profile-operands.js';
import { commandRow, isCommandName, isFamilyWord } from './table.js';
import type { PlacedFlag } from './table.js';

/** A placement rule: the message when the command may not take a flag it was given. */
type PlacementRule = (name: CommandName, flags: CommandFlags) => string | undefined;

/** What to type instead, after a flag Node refused. */
const commonUsage =
  'Use canvas describe | list | read ID | create FILE | patch FILE --revision N | preview FILE.';

/** The placement rules in the base CLI's order; the first broken rule is reported. */
const placementRules: readonly PlacementRule[] = Object.freeze([
  onlyWhereTaken(['profile'], '--profile is only valid with profile lint.'),
  lintNeedsProfile,
  onlyWhereTaken(
    ['id', 'title'],
    '--id and --title are only valid with profile scaffold or recipe admit.',
  ),
  scopeFlagsExclusive,
  onlyWhereTaken(['section', 'object'], '--section and --object are only valid with read.'),
]);

/**
 * The command `reading` names, with its checked fields. Fails with `invalid-arguments` (a flag
 * Node refused, a repeated --section or --object, a wrong operand count or a misplaced flag),
 * `invalid-command` (no such command), or a value failure from `assembleCommand`.
 */
export function parseCommand(
  reading: ArgvReading<CanvasFlag>,
  defaults: CommandDefaults,
): Result<ParsedCommand> {
  if (reading.kind === 'malformed') return malformedFlags();
  const words = commandWords(reading.arguments);
  if (!words.ok) return words;
  return assembleCommand(words.value, defaults);
}

/**
 * A repeated read scope flag first (Node would keep only the last value), then the command word.
 * Fails with `invalid-arguments` or `invalid-command`.
 */
function commandWords(raw: RawArguments<CanvasFlag>): Result<CommandWords> {
  if (raw.repeated.some(isScopeFlag))
    return invalidArguments('Each read scope flag may be provided only once.');
  const [word = '', ...operands] = spokenWords(raw);
  if (!isCommandName(word))
    return failure({
      code: 'invalid-command',
      message: 'Choose a supported canvas or profile command',
    });
  return placed(word, operands, flagText(raw.values));
}

/** `--help` stands for the `help` command and drops every word; a family word joins the next word. */
function spokenWords(raw: RawArguments<CanvasFlag>): readonly string[] {
  if (raw.values.get('help') === true) return ['help'];
  const [first = '', second = '', ...rest] = raw.positionals;
  if (!isFamilyWord(first)) return raw.positionals;
  return [`${first}-${second}`, ...rest];
}

/**
 * Exactly the table's operand count, then every placement rule. Operands cannot be silently
 * ignored. Fails with `invalid-arguments`.
 */
function placed(
  name: CommandName,
  operands: readonly string[],
  flags: CommandFlags,
): Result<CommandWords> {
  const count = commandRow(name).operands;
  if (operands.length !== count) return invalidArguments(`${name} requires ${count} operand(s)`);
  const misplaced = placementRules.map((rule) => rule(name, flags)).find(isMessage);
  if (misplaced !== undefined) return invalidArguments(misplaced);
  return success({ name, operand: firstOperand(operands), flags });
}

/** The one operand, or `''` for a command that takes none. */
function firstOperand(operands: readonly string[]): string {
  return operands[0] ?? '';
}

/** A rule: any flag of `group` given to a command whose row does not take it fails with `message`. */
function onlyWhereTaken(
  group: readonly PlacedFlag[],
  message: string,
): PlacementRule {
  return (name, flags) =>
    group.some((flag) => isMisplaced(name, flag, flags)) ? message : undefined;
}

/** Whether `flag` is given to a command that does not take it. */
function isMisplaced(
  name: CommandName,
  flag: PlacedFlag,
  flags: CommandFlags,
): boolean {
  return flags[flag] !== undefined && !commandRow(name).placed.includes(flag);
}

/** `profile lint` needs --profile. Checked before the read scope flags, as the base CLI does. */
function lintNeedsProfile(
  name: CommandName,
  flags: CommandFlags,
): string | undefined {
  if (name !== 'profile-lint' || flags.profile !== undefined) return undefined;
  return lintProfileRequired;
}

/** At most one of --section and --object, whichever command is given them. */
function scopeFlagsExclusive(
  _name: CommandName,
  flags: CommandFlags,
): string | undefined {
  if (flags.section === undefined || flags.object === undefined) return undefined;
  return '--section and --object are mutually exclusive for read.';
}

/** Whether the flag is --section or --object. */
function isScopeFlag(flag: CanvasFlag): boolean {
  return flag === 'section' || flag === 'object';
}

/** Whether a placement rule returned a message. */
function isMessage(text: string | undefined): text is string {
  return text !== undefined;
}

/** Node refused the argv: an unknown flag, a text flag with no value, or a value on a switch. */
function malformedFlags(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Unknown or malformed CLI flag',
    recovery: commonUsage,
  });
}

/** A malformed or misplaced argument; nothing was read or sent. */
function invalidArguments(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-arguments', message });
}
