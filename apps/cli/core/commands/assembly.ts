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
  Command,
  ParsedCommand,
  ReadScope,
  Revises,
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
import {
  checkChangeMode,
  checkReadScope,
  checkRevisionOption,
  checkServiceOptions,
} from './values.js';

/** --mode (how a DSL source changes a collection) and --revision (the revision the agent read). */
interface ModeAndRevision {
  readonly mode: ChangeMode;
  readonly revisionOption: Revises;
}

/**
 * The read scope, --mode and --revision. Checked for every command before its operand, so the
 * first failure matches the base CLI. A command that does not take them was refused them, so it
 * holds the defaults and does not read them.
 */
interface ScopeModeAndRevision extends ModeAndRevision {
  readonly scope: ReadScope;
}

/**
 * Assembles the accepted command with every value checked.
 *
 * Steps; the first failure stops assembly and is returned unchanged:
 * 1. Check the read scope, --mode, then --revision.
 * 2. Build the command: its operand first, then its own flags, --request and --out.
 * 3. Classify the command: `help` and profile commands run locally; a service command also gets
 *    its checked --server and --workspace (`defaultWorkspace` when the flag is absent).
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
  const command = buildCommand(accepted, scopeModeAndRevision.value);
  if (!command.ok) {
    return command;
  }
  return classifyCommand(command.value, accepted.flags, defaultWorkspace);
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

/** A command that takes no operand, or one with its operand. Fails as its builder does. */
function buildCommand(
  accepted: AcceptedCommand,
  scopeModeAndRevision: ScopeModeAndRevision,
): Result<Command> {
  switch (accepted.kind) {
    case 'no-operand':
      return buildNoOperandCommand(accepted);
    case 'one-operand':
      return buildOperandCommand(accepted, scopeModeAndRevision);
    default:
      return unsupported(accepted);
  }
}

/** `help`, which carries no values; or `describe` or `list` with --out. Fails as its builder does. */
function buildNoOperandCommand(accepted: AcceptedWithoutOperand): Result<Command> {
  const { name, flags } = accepted;
  switch (name) {
    case 'help':
      return success({ name });
    case 'describe':
    case 'list':
      return buildAnswerOnlyCommand(name, flags);
    default:
      return unsupported(name);
  }
}

/** The command its name picks, built from its operand and flags. Fails as that builder does. */
function buildOperandCommand(
  accepted: AcceptedWithOperand,
  scopeModeAndRevision: ScopeModeAndRevision,
): Result<Command> {
  const { name, operand, flags } = accepted;
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

/**
 * The command sorted by who runs it: `help` and profile commands run locally; a service command
 * is sent, so its --server and --workspace are checked here. Fails with `invalid-server`.
 */
function classifyCommand(
  command: Command,
  flags: CommandFlags,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  switch (command.name) {
    case 'help':
      return success({ kind: 'help' });
    case 'profile-describe':
    case 'profile-scaffold':
    case 'profile-lint':
      return success({ kind: 'profile', command });
    case 'describe':
    case 'list':
    case 'read':
    case 'inspect':
    case 'receipt':
    case 'retry':
    case 'apply':
    case 'create':
    case 'replace':
    case 'patch':
    case 'preview':
    case 'theme-admit':
    case 'recipe-admit':
    case 'recipe-instantiate':
      return addServiceOptions(command, flags, defaultWorkspace);
    default:
      return unsupported(command);
  }
}

/** The service command with its --server, then --workspace. Fails with `invalid-server`. */
function addServiceOptions(
  command: ServiceCommand,
  flags: CommandFlags,
  defaultWorkspace: WorkspaceText,
): Result<ParsedCommand> {
  const options = checkServiceOptions(flags, defaultWorkspace);
  if (!options.ok) {
    return options;
  }
  return success({ kind: 'service', command, options: options.value });
}
