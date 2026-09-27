/*
 * `pnpm canvas` command assembly: the adapter's words and flags become one `ParsedCommand`, each
 * command carrying only the checked fields it reads. Pure. Checks run in the base CLI's order: the
 * read scope, --mode and --revision for every command, then the command's operand and its own
 * flags. A rejected value is a failure naming the argument; nothing was read or sent, so the
 * caller corrects it and runs the command again.
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
import type { CommandArguments, CommandFlags } from '../../contract/records/arguments.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { joined, mapped, unsupported } from '../shared/results.js';
import { profileCommand } from './profile-operands.js';
import { expansion, recipeHeader } from './recipe-values.js';
import {
  changeMode,
  collection,
  readScope,
  request,
  retains,
  revises,
  sourceFile,
  writes,
} from './values.js';

/** What every command checks, as the base CLI does; only the commands that use a value keep it. */
interface SharedFlags {
  readonly scope: ReadScope;
  readonly mode: ChangeMode;
  readonly revises: Revises;
}

/**
 * The command the arguments name, with its checked fields. Fails with `invalid-arguments`,
 * `invalid-mode`, `invalid-revision`, `invalid-request`, `unknown-profile`, `source-unavailable`
 * (an empty FILE) or `output-unavailable` (an empty --out).
 */
export function parseCommand(input: CommandArguments): Result<ParsedCommand> {
  const shared = sharedFlags(input.name, input.flags);
  if (!shared.ok) return shared;
  return routed(input, shared.value);
}

/** The read scope, then --mode, then --revision. */
function sharedFlags(
  name: CommandName,
  flags: CommandFlags,
): Result<SharedFlags> {
  const scoped = joined(readScope(flags), changeMode(name, flags.mode), (scope, mode) => ({
    scope,
    mode,
  }));
  return joined(scoped, revises(flags.revision), (fields, revision) => ({
    ...fields,
    revises: revision,
  }));
}

/** Help, a local profile command, or a service command with its server and workspace. */
function routed(
  input: CommandArguments,
  shared: SharedFlags,
): Result<ParsedCommand> {
  const { name, operand, flags, options } = input;
  switch (name) {
    case 'help':
      return success({ kind: 'help' });
    case 'profile-describe':
    case 'profile-scaffold':
    case 'profile-lint':
      return mapped(profileCommand(name, operand, flags), (command) => ({
        kind: 'profile',
        command,
      }));
    default:
      return mapped(serviceCommand(name, operand, flags, shared), (command) => ({
        kind: 'service',
        command,
        options,
      }));
  }
}

/** One service command: its operand first, then its own flags, --request, then --out. */
function serviceCommand(
  name: ServiceCommand['name'],
  operand: string,
  flags: CommandFlags,
  shared: SharedFlags,
): Result<ServiceCommand> {
  switch (name) {
    case 'describe':
    case 'list':
      return mapped(writes(flags), (written) => ({ name, ...written }));
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
