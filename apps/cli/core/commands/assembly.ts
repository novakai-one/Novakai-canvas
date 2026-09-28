/*
 * `pnpm canvas` command assembly: a placed command's operand and flag text become one
 * `ParsedCommand`, each command carrying only the checked fields it reads; each service command
 * with an operand has its builder in `service-commands.ts`. Pure. Runs after `placement.ts`
 * refused every flag the command does not accept. Order: the read scope, --mode
 * and --revision, then the command's operand, its own flags, --request and --out, then a service
 * command's --server and --workspace. A rejected value is a failure naming the argument; nothing
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
import type { CommandFlags } from './flags.js';
import { hasOperand } from './placed-command.js';
import type { PlacedCommand, PlacedWithOperand, PlacedWithoutOperand } from './placed-command.js';
import { checkProfileCommand } from './profile-operands.js';
import {
  buildInspectCommand,
  buildPreviewCommand,
  buildReadCommand,
  buildRecipeAdmitCommand,
  buildRecipeInstantiateCommand,
  buildRequestCommand,
  buildRevisedSourceCommand,
  buildSourceCommand,
} from './service-commands.js';
import {
  checkChangeMode,
  checkOutOption,
  checkReadScope,
  checkRevision,
  checkServiceOptions,
} from './values.js';

/** --mode and --revision: how a DSL source changes a collection; the revision the agent read. */
interface ChangeFlags {
  readonly mode: ChangeMode;
  readonly revises: Revises;
}

/**
 * The read scope, change mode and revision, checked first for every command, as the base CLI
 * does. `placement.ts` refused these flags on a command that does not accept them, so that
 * command sees only defaults and drops them.
 */
interface SharedFlags extends ChangeFlags {
  readonly scope: ReadScope;
}

/**
 * Assembles the placed command with every value checked.
 *
 * Steps; the first failure stops assembly and is returned unchanged:
 * 1. Check the shared flags: the read scope, --mode, then --revision.
 * 2. Build the command: its operand first, then its own flags, --request and --out.
 * 3. Route the command: help and profile commands run locally; a service command also gets its
 *    checked --server and --workspace (`defaultWorkspace` when the flag is absent).
 *
 * Fails with `invalid-arguments`, `invalid-mode`, `invalid-revision`, `invalid-request`,
 * `unknown-profile`, `source-unavailable` (an empty FILE), `output-unavailable` (an empty --out)
 * or `invalid-server`.
 */
export function assembleCommand(
  placed: PlacedCommand,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  const shared = checkSharedFlags(placed.name, placed.flags);
  if (!shared.ok) {
    return shared;
  }
  const command = buildCommand(placed, shared.value);
  if (!command.ok) {
    return command;
  }
  return routeCommand(command.value, placed.flags, defaultWorkspace);
}

/**
 * The read scope, then --mode and --revision. Fails with `invalid-arguments`, then `invalid-mode`,
 * then `invalid-revision`.
 */
function checkSharedFlags(
  name: CommandName,
  flags: CommandFlags,
): Result<SharedFlags> {
  const scope = checkReadScope(flags);
  if (!scope.ok) {
    return scope;
  }
  const change = checkChangeFlags(name, flags);
  if (!change.ok) {
    return change;
  }
  return success({ scope: scope.value, ...change.value });
}

/**
 * --mode (the command's own mode for `create`, `replace` and `patch`), then --revision. Fails
 * with `invalid-mode`, then `invalid-revision`.
 */
function checkChangeFlags(
  name: CommandName,
  flags: CommandFlags,
): Result<ChangeFlags> {
  const mode = checkChangeMode(name, flags);
  if (!mode.ok) {
    return mode;
  }
  const revises = checkRevision(flags.revision);
  if (!revises.ok) {
    return revises;
  }
  return success({ mode: mode.value, revises: revises.value });
}

/** A command that takes no operand, or one with its operand. Fails as its builder does. */
function buildCommand(
  placed: PlacedCommand,
  shared: SharedFlags,
): Result<Command> {
  if (!hasOperand(placed)) {
    return buildNoOperandCommand(placed);
  }
  return buildOperandCommand(placed, shared);
}

/**
 * `help`, which carries no values; or `describe` or `list` with --out. Fails with
 * `output-unavailable`.
 */
function buildNoOperandCommand(placed: PlacedWithoutOperand): Result<Command> {
  const { name, flags } = placed;
  if (name === 'help') {
    return success({ name });
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name, ...outOption.value });
}

/** The command its name picks, built from its operand and flags. Fails as that builder does. */
function buildOperandCommand(
  placed: PlacedWithOperand,
  shared: SharedFlags,
): Result<Command> {
  const { name, operand, flags } = placed;
  switch (name) {
    case 'read':
      return buildReadCommand(operand, flags, shared.scope);
    case 'inspect':
      return buildInspectCommand(operand, flags);
    case 'receipt':
    case 'retry':
    case 'apply':
      return buildRequestCommand(name, operand, flags);
    case 'create':
    case 'theme-admit':
      return buildSourceCommand(name, operand, flags);
    case 'replace':
    case 'patch':
      return buildRevisedSourceCommand(name, operand, flags, shared.revises);
    case 'preview':
      return buildPreviewCommand(operand, flags, shared.mode, shared.revises);
    case 'recipe-admit':
      return buildRecipeAdmitCommand(operand, flags);
    case 'recipe-instantiate':
      return buildRecipeInstantiateCommand(operand, flags);
    case 'profile-describe':
    case 'profile-scaffold':
    case 'profile-lint':
      return checkProfileCommand(name, operand, flags);
    default:
      return unsupported(name);
  }
}

/**
 * Where the command runs: `help` prints usage and a profile command runs locally; a service
 * command is sent, so --server and --workspace are checked here. Fails with `invalid-server`.
 */
function routeCommand(
  command: Command,
  flags: CommandFlags,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  switch (command.name) {
    case 'help':
      return success({ kind: 'help' });
    case 'profile-describe':
    case 'profile-scaffold':
    case 'profile-lint':
      return success({ kind: 'profile', command });
    default:
      return addServiceOptions(command, flags, defaultWorkspace);
  }
}

/** The service command with its --server, then --workspace. Fails with `invalid-server`. */
function addServiceOptions(
  command: ServiceCommand,
  flags: CommandFlags,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  const options = checkServiceOptions(flags, defaultWorkspace);
  if (!options.ok) {
    return options;
  }
  return success({ kind: 'service', command, options: options.value });
}
