/*
 * Why this file exists
 *
 * Once the command and its flags fit, every value is still text as typed. In
 * `pnpm canvas replace plan.canvas --revision 3`, the `3` is text, not yet a revision number.
 *
 * This file checks every value and builds the one `ParsedCommand` the CLI runs, filling in any
 * option left out. It never reads a file or talks to the service. Each value is checked in
 * `values.ts`, `recipe-values.ts` or `server-and-workspace.ts`.
 */
import type {
  ChangeMode,
  CommandName,
  ParsedCommand,
  ProfileCommand,
  ReadScope,
  RevisionOption,
  ServiceCommand,
} from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { unsupported } from '../shared/results.js';
import type {
  AcceptedCommand,
  AcceptedNoOperandCommand,
  AcceptedOneOperandCommand,
} from './command-stages.js';
import type { FilePath } from '../../contract/brands.js';
import type { FlagTextAsTyped } from './flags.js';
import {
  buildProfileDescribeCommand,
  buildProfileLintCommand,
  buildProfileScaffoldCommand,
} from './profile-commands.js';
import {
  buildCreateOrThemeAdmitCommand,
  buildDescribeOrListCommand,
  buildInspectCommand,
  buildPreviewCommand,
  buildReadCommand,
  buildReceiptRetryOrApplyCommand,
  buildRecipeAdmitCommand,
  buildRecipeInstantiateCommand,
  buildReplaceOrPatchCommand,
} from './service-commands.js';
import { checkServerAndWorkspace } from './server-and-workspace.js';
import type { OneOperandCommand } from './table.js';
import { checkChangeMode, checkReadScope, checkRevisionOption } from './values.js';

/** The commands that run locally with a build-spec profile. */
type ProfileCommandName = ProfileCommand['name'];

/** A service command that takes one operand: every one-operand command but the profile commands. */
type OperandServiceCommandName = Exclude<OneOperandCommand, ProfileCommandName>;

/** --mode (how a DSL source changes a collection) and --revision (the revision the agent read). */
interface ModeAndRevision {
  readonly mode: ChangeMode;
  readonly revisionOption: RevisionOption;
}

/**
 * The read scope, --mode and --revision. Checked for every command before its operand, so these
 * mistakes are reported first. A command that doesn't accept them was already refused them, so it
 * holds the defaults and does not read them.
 */
interface ScopeModeAndRevision extends ModeAndRevision {
  readonly scope: ReadScope;
}

/** Every profile command, keyed by itself. */
const profileCommands: Readonly<Record<ProfileCommandName, ProfileCommandName>> = Object.freeze({
  'profile-describe': 'profile-describe',
  'profile-scaffold': 'profile-scaffold',
  'profile-lint': 'profile-lint',
} satisfies Record<ProfileCommandName, ProfileCommandName>);

/**
 * Checks every value typed with the command, and builds the `ParsedCommand` the CLI runs.
 *
 * 1. Check `--section` or `--object`, then `--mode`, then `--revision`.
 * 2. Check the word after the command, then the command's own flags.
 * 3. For a service command, check `--server` and `--workspace` (or use `defaultWorkspace`).
 *
 * The mistakes it can find: any value typed wrong, such as a bad `--revision` or collection ID.
 */
export function assembleCommand(
  accepted: AcceptedCommand,
  defaultWorkspace: FilePath,
): Result<ParsedCommand> {
  const scopeModeAndRevision = checkScopeModeAndRevision(accepted.name, accepted.flags);
  if (!scopeModeAndRevision.ok) {
    return scopeModeAndRevision;
  }
  return buildCommand(accepted, scopeModeAndRevision.value, defaultWorkspace);
}

/** Checks the read scope, then `--mode` and `--revision`, and keeps all three. */
function checkScopeModeAndRevision(
  name: CommandName,
  flags: FlagTextAsTyped,
): Result<ScopeModeAndRevision> {
  const scope = checkReadScope(flags);
  if (!scope.ok) {
    return scope;
  }
  const modeAndRevision = checkModeAndRevision(name, flags);
  if (!modeAndRevision.ok) {
    return modeAndRevision;
  }
  return success({ scope: scope.value, ...modeAndRevision.value });
}

/** Checks `--mode` (or takes the command's own mode), then `--revision`. */
function checkModeAndRevision(
  name: CommandName,
  flags: FlagTextAsTyped,
): Result<ModeAndRevision> {
  const mode = checkChangeMode(name, flags);
  if (!mode.ok) {
    return mode;
  }
  const revisionOption = checkRevisionOption(flags);
  if (!revisionOption.ok) {
    return revisionOption;
  }
  return success({ mode: mode.value, revisionOption: revisionOption.value });
}

/** Builds the command, by whether it takes a word after it. */
function buildCommand(
  accepted: AcceptedCommand,
  scopeModeAndRevision: ScopeModeAndRevision,
  defaultWorkspace: FilePath,
): Result<ParsedCommand> {
  switch (accepted.kind) {
    case 'no-operand':
      return buildNoOperandCommand(accepted, defaultWorkspace);
    case 'one-operand':
      return buildOperandCommand(accepted, scopeModeAndRevision, defaultWorkspace);
    default:
      return unsupported(accepted);
  }
}

/** Builds `help`, which needs nothing more, or `describe` or `list`, which go to the service. */
function buildNoOperandCommand(
  accepted: AcceptedNoOperandCommand,
  defaultWorkspace: FilePath,
): Result<ParsedCommand> {
  const { name, flags } = accepted;
  if (name === 'help') {
    return success({ kind: 'help' });
  }
  const serviceCommand = buildDescribeOrListCommand(name, flags);
  if (!serviceCommand.ok) {
    return serviceCommand;
  }
  return addServerAndWorkspace(serviceCommand.value, flags, defaultWorkspace);
}

/** Builds a command with its word: a profile command runs here, any other goes to the service. */
function buildOperandCommand(
  accepted: AcceptedOneOperandCommand,
  scopeModeAndRevision: ScopeModeAndRevision,
  defaultWorkspace: FilePath,
): Result<ParsedCommand> {
  const { name, operand, flags } = accepted;
  if (isProfileCommandName(name)) {
    return buildLocalProfileCommand(name, operand, flags);
  }
  const serviceCommand = buildServiceCommand(name, operand, flags, scopeModeAndRevision);
  if (!serviceCommand.ok) {
    return serviceCommand;
  }
  return addServerAndWorkspace(serviceCommand.value, flags, defaultWorkspace);
}

/** Builds a profile command, and marks it to run on this machine. */
function buildLocalProfileCommand(
  name: ProfileCommandName,
  operand: string,
  flags: FlagTextAsTyped,
): Result<ParsedCommand> {
  const profileCommand = buildProfileCommand(name, operand, flags);
  if (!profileCommand.ok) {
    return profileCommand;
  }
  return success({ kind: 'profile', command: profileCommand.value });
}

/** Builds the profile command its name picks, from its word and flags. */
function buildProfileCommand(
  name: ProfileCommandName,
  operand: string,
  flags: FlagTextAsTyped,
): Result<ProfileCommand> {
  switch (name) {
    case 'profile-describe':
      return buildProfileDescribeCommand(operand, flags);
    case 'profile-scaffold':
      return buildProfileScaffoldCommand(operand, flags);
    case 'profile-lint':
      return buildProfileLintCommand(operand, flags);
    default:
      return unsupported(name);
  }
}

/** Builds the service command its name picks, from its word, flags and the values checked first. */
function buildServiceCommand(
  name: OperandServiceCommandName,
  operand: string,
  flags: FlagTextAsTyped,
  scopeModeAndRevision: ScopeModeAndRevision,
): Result<ServiceCommand> {
  const { scope, mode, revisionOption } = scopeModeAndRevision;
  switch (name) {
    case 'read':
      return buildReadCommand(operand, flags, scope);
    case 'inspect':
      return buildInspectCommand(operand, flags);
    case 'receipt':
    case 'retry':
    case 'apply':
      return buildReceiptRetryOrApplyCommand(name, operand, flags);
    case 'create':
    case 'theme-admit':
      return buildCreateOrThemeAdmitCommand(name, operand, flags);
    case 'replace':
    case 'patch':
      return buildReplaceOrPatchCommand(name, operand, flags, revisionOption);
    case 'preview':
      return buildPreviewCommand(operand, flags, mode, revisionOption);
    case 'recipe-admit':
      return buildRecipeAdmitCommand(operand, flags);
    case 'recipe-instantiate':
      return buildRecipeInstantiateCommand(operand, flags);
    default:
      return unsupported(name);
  }
}

/** Checks `--server` and `--workspace`, and adds them to the service command. */
function addServerAndWorkspace(
  command: ServiceCommand,
  flags: FlagTextAsTyped,
  defaultWorkspace: FilePath,
): Result<ParsedCommand> {
  const options = checkServerAndWorkspace(flags, defaultWorkspace);
  if (!options.ok) {
    return options;
  }
  return success({ kind: 'service', command, options: options.value });
}

/** Whether the command is one of the three profile commands, which run on this machine. */
function isProfileCommandName(name: OneOperandCommand): name is ProfileCommandName {
  return Object.hasOwn(profileCommands, name);
}
