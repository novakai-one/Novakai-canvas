/*
 * `pnpm canvas` command assembly: the grammar's words and flag text become one `ParsedCommand`,
 * each command carrying only the checked fields it reads. Pure. Runs after `parse.ts` refused
 * every flag the command does not read. Order: the read scope, --mode and --revision, then the
 * command's operand, its own flags, --request and --out, then a service command's --server and
 * --workspace. A rejected value is a failure naming the argument; nothing was read or sent, so the
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
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { joined, mapped, unsupported } from '../shared/results.js';
import type { CommandDefaults, CommandFlags } from './flags.js';
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
import type { CommandWords } from './words.js';

/**
 * The read scope, change mode and revision, checked first as the base CLI does. `parse.ts` refused
 * these flags on a command that does not read them, so that command sees only defaults and drops
 * them.
 */
interface SharedFlags {
  readonly scope: ReadScope;
  readonly mode: ChangeMode;
  readonly revises: Revises;
}

/**
 * The command the words name, with its checked fields. Fails with `invalid-arguments`,
 * `invalid-mode`, `invalid-revision`, `invalid-request`, `unknown-profile`, `source-unavailable`
 * (an empty FILE), `output-unavailable` (an empty --out) or `invalid-server`.
 */
export function assembleCommand(
  words: CommandWords,
  defaults: CommandDefaults,
): Result<ParsedCommand> {
  const shared = sharedFlags(words.name, words.flags);
  if (!shared.ok) return shared;
  return routed(words, shared.value, defaults);
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

/** Help, a local profile command, or a service command with its server and workspace. */
function routed(
  words: CommandWords,
  shared: SharedFlags,
  defaults: CommandDefaults,
): Result<ParsedCommand> {
  const { name, operand, flags } = words;
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
      return joined(
        serviceCommand(name, operand, flags, shared),
        serviceOptions(flags, defaults),
        (command, options) => ({ kind: 'service', command, options }),
      );
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
