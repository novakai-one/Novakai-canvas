/*
 * `pnpm canvas` command assembly: an accepted command's operand and flag text become one
 * `ParsedCommand`, each command carrying only the checked fields it reads. The builders are in
 * `service-commands.ts` and `profile-commands.ts`. Pure. Values are checked in the base CLI's
 * order (listed on `assembleCommand`). A rejected value is a failure naming the argument; nothing
 * was read or sent, so the caller corrects it and runs the command again.
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
  AcceptedWithOperand,
  AcceptedWithoutOperand,
} from './command-stages.js';
import type { CommandFlags, WorkspaceText } from './flags.js';
import {
  buildProfileDescribeCommand,
  buildProfileLintCommand,
  buildProfileScaffoldCommand,
} from './profile-commands.js';
import {
  buildAnswerOnlyCommand,
  buildFileCommand,
  buildInspectCommand,
  buildPreviewCommand,
  buildReadCommand,
  buildRecipeAdmitCommand,
  buildRecipeInstantiateCommand,
  buildRequestCommand,
  buildRevisionCheckedCommand,
} from './service-commands.js';
import type { OneOperandCommand } from './table.js';
import {
  checkChangeMode,
  checkReadScope,
  checkRevisionOption,
  checkServiceOptions,
} from './values.js';

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
 * The read scope, --mode and --revision. Checked for every command before its operand, so the
 * first failure matches the base CLI. A command that does not take them was refused them, so it
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
 * Assembles the accepted command with every value checked.
 *
 * Steps; the first failure stops assembly and is returned unchanged:
 * 1. Check the read scope, --mode, then --revision.
 * 2. Build the command for who runs it. `help` carries no values. A profile command runs locally:
 *    its operand, then its own flags and --out. A service command is sent: its operand, then its
 *    own flags, --request and --out, then its --server and --workspace (`defaultWorkspace` when
 *    the flag is absent).
 *
 * Fails with `invalid-arguments`, `invalid-mode`, `invalid-revision`, `invalid-request`,
 * `unknown-profile`, `source-unavailable` (an empty FILE), `output-unavailable` (an empty --out)
 * or `invalid-server`.
 */
export function assembleCommand(
  accepted: AcceptedCommand,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  const scopeModeAndRevision = checkScopeModeAndRevision(accepted.name, accepted.flags);
  if (!scopeModeAndRevision.ok) {
    return scopeModeAndRevision;
  }
  return buildCommand(accepted, scopeModeAndRevision.value, defaultWorkspace);
}

/**
 * The read scope, then --mode and --revision. Fails with `invalid-arguments`, then `invalid-mode`,
 * then `invalid-revision`.
 */
function checkScopeModeAndRevision(
  name: CommandName,
  flags: CommandFlags,
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

/**
 * --mode (the command's own mode for `create`, `replace` and `patch`), then --revision. Fails
 * with `invalid-mode`, then `invalid-revision`.
 */
function checkModeAndRevision(
  name: CommandName,
  flags: CommandFlags,
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

/**
 * The command built by whether it takes an operand. Fails as its builder does, then with
 * `invalid-server`.
 */
function buildCommand(
  accepted: AcceptedCommand,
  scopeModeAndRevision: ScopeModeAndRevision,
  defaultWorkspace: WorkspaceText,
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

/**
 * `help`, which carries no values; or `describe` or `list`, sent with --out. Fails with
 * `output-unavailable`, then `invalid-server`.
 */
function buildNoOperandCommand(
  accepted: AcceptedWithoutOperand,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  const { name, flags } = accepted;
  if (name === 'help') {
    return success({ kind: 'help' });
  }
  const serviceCommand = buildAnswerOnlyCommand(name, flags);
  return addServiceOptions(serviceCommand, flags, defaultWorkspace);
}

/**
 * A command with its operand: a profile command runs locally; any other is a service command,
 * sent with its --server and --workspace. Fails as its builder does, then with `invalid-server`.
 */
function buildOperandCommand(
  accepted: AcceptedWithOperand,
  scopeModeAndRevision: ScopeModeAndRevision,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  const { name, operand, flags } = accepted;
  if (isProfileCommandName(name)) {
    const profileCommand = buildProfileCommand(name, operand, flags);
    return routeLocally(profileCommand);
  }
  const serviceCommand = buildServiceCommand(name, operand, flags, scopeModeAndRevision);
  return addServiceOptions(serviceCommand, flags, defaultWorkspace);
}

/** The profile command its name picks, from its operand and flags. Fails as that builder does. */
function buildProfileCommand(
  name: ProfileCommandName,
  operand: string,
  flags: CommandFlags,
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

/** The built profile command, routed to run locally. Passes its builder's failure on unchanged. */
function routeLocally(profileCommand: Result<ProfileCommand>): Result<ParsedCommand> {
  if (!profileCommand.ok) {
    return profileCommand;
  }
  return success({ kind: 'profile', command: profileCommand.value });
}

/** The service command its name picks, from its operand and flags. Fails as that builder does. */
function buildServiceCommand(
  name: OperandServiceCommandName,
  operand: string,
  flags: CommandFlags,
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
      return buildRequestCommand(name, operand, flags);
    case 'create':
    case 'theme-admit':
      return buildFileCommand(name, operand, flags);
    case 'replace':
    case 'patch':
      return buildRevisionCheckedCommand(name, operand, flags, revisionOption);
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

/**
 * The built service command with its --server, then --workspace. Passes its builder's failure on
 * unchanged, then fails with `invalid-server`.
 */
function addServiceOptions(
  serviceCommand: Result<ServiceCommand>,
  flags: CommandFlags,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  if (!serviceCommand.ok) {
    return serviceCommand;
  }
  const options = checkServiceOptions(flags, defaultWorkspace);
  if (!options.ok) {
    return options;
  }
  return success({ kind: 'service', command: serviceCommand.value, options: options.value });
}

/** Whether the command runs locally with a build-spec profile. */
function isProfileCommandName(name: OneOperandCommand): name is ProfileCommandName {
  return Object.hasOwn(profileCommands, name);
}
