/*
 * `pnpm canvas` command assembly: the placed command's operand and flag text become one
 * `ParsedCommand`, each command carrying only the checked fields it reads. Pure. Runs after
 * `placement.ts` refused every flag the command does not accept. Order: the read scope, --mode
 * and --revision, then the command's operand, its own flags, --request and --out, then a service
 * command's --server and --workspace. A rejected value is a failure naming the argument; nothing
 * was read or sent, so the caller corrects it and runs the command again.
 */
import type {
  ChangeMode,
  CommandName,
  ParsedCommand,
  ReadScope,
  RecipeHeader,
  Retains,
  Revises,
  ServiceCommand,
  Writes,
} from '../../contract/records/command.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { joined, mapped, unsupported } from '../shared/results.js';
import type { CommandFlags } from './flags.js';
import { hasOperand } from './placed-command.js';
import type { PlacedCommand, PlacedWithOperand, PlacedWithoutOperand } from './placed-command.js';
import { profileCommand } from './profile-operands.js';
import { expansion, recipeHeader } from './recipe-values.js';
import {
  changeMode,
  collection,
  readScope,
  request,
  retains,
  revises,
  serviceOptions,
  sourceFile,
  writes,
} from './values.js';
import type { NoOperandCommand } from './table.js';

/**
 * The read scope, change mode and revision, checked first as the base CLI does. `placement.ts`
 * refused these flags on a command that does not accept them, so that command sees only defaults
 * and drops them.
 */
interface SharedFlags {
  readonly scope: ReadScope;
  readonly mode: ChangeMode;
  readonly revises: Revises;
}

/** A service command that takes one operand: every service command but `describe` and `list`. */
type OneOperandServiceCommand = Exclude<ServiceCommand['name'], NoOperandCommand>;

/**
 * The placed command with its checked fields; `defaultWorkspace` is the --workspace text used when
 * the flag is absent. Fails with `invalid-arguments`, `invalid-mode`, `invalid-revision`,
 * `invalid-request`, `unknown-profile`, `source-unavailable` (an empty FILE), `output-unavailable`
 * (an empty --out) or `invalid-server`.
 */
export function assembleCommand(
  placed: PlacedCommand,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  const shared = sharedFlags(placed.name, placed.flags);
  if (!shared.ok) return shared;
  return routed(placed, shared.value, defaultWorkspace);
}

/** The read scope, then --mode, then --revision. */
function sharedFlags(
  name: CommandName,
  flags: CommandFlags,
): Result<SharedFlags> {
  const scoped = joined(readScope(flags), changeMode(name, flags), (scope, mode) => ({
    scope,
    mode,
  }));
  return joined(scoped, revises(flags.revision), (fields, revision) => ({
    ...fields,
    revises: revision,
  }));
}

/** A command that takes no operand, or a command with its one operand. */
function routed(
  placed: PlacedCommand,
  shared: SharedFlags,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  if (!hasOperand(placed)) return withoutOperand(placed, defaultWorkspace);
  return withOperand(placed, shared, defaultWorkspace);
}

/** Help, or `describe` or `list` with --out, then its server and workspace. */
function withoutOperand(
  placed: PlacedWithoutOperand,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  const { name, flags } = placed;
  if (name === 'help') return success({ kind: 'help' });
  const command = mapped(writes(flags), (written) => ({ name, ...written }));
  return withServiceOptions(command, flags, defaultWorkspace);
}

/** A local profile command, or a service command with its server and workspace. */
function withOperand(
  placed: PlacedWithOperand,
  shared: SharedFlags,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  const { name, operand, flags } = placed;
  switch (name) {
    case 'profile-describe':
    case 'profile-scaffold':
    case 'profile-lint':
      return mapped(profileCommand(name, operand, flags), (command) => ({
        kind: 'profile',
        command,
      }));
    default:
      return withServiceOptions(
        serviceCommand(name, operand, flags, shared),
        flags,
        defaultWorkspace,
      );
  }
}

/** The service command, then --server and --workspace, checked in that order. */
function withServiceOptions(
  command: Result<ServiceCommand>,
  flags: CommandFlags,
  defaultWorkspace: string,
): Result<ParsedCommand> {
  return joined(command, serviceOptions(flags, defaultWorkspace), (checked, options) => ({
    kind: 'service',
    command: checked,
    options,
  }));
}

/** One service command with an operand: the operand first, then its own flags, --request, --out. */
function serviceCommand(
  name: OneOperandServiceCommand,
  operand: string,
  flags: CommandFlags,
  shared: SharedFlags,
): Result<ServiceCommand> {
  switch (name) {
    case 'read':
      return joined(collection(operand), writes(flags), (id, written) => ({
        name,
        collection: id,
        scope: shared.scope,
        ...written,
      }));
    case 'inspect':
      return joined(collection(operand), writes(flags), (id, written) => ({
        name,
        collection: id,
        ...written,
      }));
    case 'receipt':
    case 'retry':
    case 'apply':
      return joined(request(operand), writes(flags), (id, written) => ({
        name,
        request: id,
        ...written,
      }));
    case 'create':
    case 'theme-admit':
      return joined(sourceFile(operand), retainsWrites(flags), (file, extra) => ({
        name,
        file,
        ...extra,
      }));
    case 'replace':
    case 'patch':
      return joined(sourceFile(operand), retainsWrites(flags), (file, extra) => ({
        name,
        file,
        ...shared.revises,
        ...extra,
      }));
    case 'preview':
      return joined(sourceFile(operand), retainsWrites(flags), (file, extra) => ({
        name,
        file,
        mode: shared.mode,
        ...shared.revises,
        ...extra,
      }));
    case 'recipe-admit':
      return joined(recipeFile(operand, flags), retainsWrites(flags), (fields, extra) => ({
        name,
        ...fields,
        ...extra,
      }));
    case 'recipe-instantiate':
      return joined(expansion(operand, flags.namespace), writes(flags), (checked, written) => ({
        name,
        expansion: checked,
        ...written,
      }));
    default:
      return unsupported(name);
  }
}

/** `recipe admit`'s FILE, then its header flags. */
function recipeFile(
  operand: string,
  flags: CommandFlags,
): Result<{ readonly file: FilePath; readonly recipe: RecipeHeader }> {
  return joined(sourceFile(operand), recipeHeader(flags), (file, recipe) => ({ file, recipe }));
}

/** --request, then --out. */
function retainsWrites(flags: CommandFlags): Result<Retains & Writes> {
  return joined(retains(flags), writes(flags), (retained, written) => ({
    ...retained,
    ...written,
  }));
}
