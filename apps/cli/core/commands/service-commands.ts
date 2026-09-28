/*
 * One builder per service command that takes an operand: the operand is checked first, then the
 * command's own flags, then --request and --out. Pure. `assembly.ts` checks the read scope, --mode
 * and --revision before any builder runs, and passes in the ones a command carries. A rejected
 * value is a failure naming the argument; nothing was read or sent, so the caller corrects it and
 * runs the command again.
 */
import type {
  ChangeMode,
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
import type { CommandFlags } from './flags.js';
import { checkExpansion, checkRecipeHeader } from './recipe-values.js';
import {
  checkCollectionId,
  checkOutOption,
  checkRequestId,
  checkRequestOption,
  checkSourceFile,
} from './values.js';

/** `recipe admit`'s FILE and the recipe header from its --id --version --family --title. */
interface RecipeSource {
  readonly file: FilePath;
  readonly recipe: RecipeHeader;
}

/** --request and --out, which every command that sends a DSL source or preset file takes. */
type RequestAndOutOptions = Retains & Writes;

/**
 * `read ID`: the collection ID, then --out; the read scope was checked first. Fails with
 * `invalid-arguments`, then `output-unavailable` (an empty --out).
 */
export function buildReadCommand(
  operand: string,
  flags: CommandFlags,
  scope: ReadScope,
): Result<ServiceCommand> {
  const collection = checkCollectionId(operand);
  if (!collection.ok) {
    return collection;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'read', collection: collection.value, scope, ...outOption.value });
}

/**
 * `inspect ID`: the collection ID, then --out. Fails with `invalid-arguments`, then
 * `output-unavailable`.
 */
export function buildInspectCommand(
  operand: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const collection = checkCollectionId(operand);
  if (!collection.ok) {
    return collection;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'inspect', collection: collection.value, ...outOption.value });
}

/**
 * `receipt`, `retry` or `apply`: the request ID, then --out. Fails with `invalid-request`, then
 * `output-unavailable`.
 */
export function buildRequestCommand(
  name: 'receipt' | 'retry' | 'apply',
  operand: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const request = checkRequestId(operand);
  if (!request.ok) {
    return request;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name, request: request.value, ...outOption.value });
}

/**
 * `create FILE` or `theme admit FILE`: the file, then --request and --out. Fails with
 * `source-unavailable` (an empty FILE), then `invalid-request`, then `output-unavailable`.
 */
export function buildSourceCommand(
  name: 'create' | 'theme-admit',
  operand: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const file = checkSourceFile(operand);
  if (!file.ok) {
    return file;
  }
  const options = checkRequestAndOutOptions(flags);
  if (!options.ok) {
    return options;
  }
  return success({ name, file: file.value, ...options.value });
}

/**
 * `replace FILE` or `patch FILE`: the file, then --request and --out; --revision was checked
 * first. Fails with `source-unavailable`, then `invalid-request`, then `output-unavailable`.
 */
export function buildRevisedSourceCommand(
  name: 'replace' | 'patch',
  operand: string,
  flags: CommandFlags,
  revises: Revises,
): Result<ServiceCommand> {
  const file = checkSourceFile(operand);
  if (!file.ok) {
    return file;
  }
  const options = checkRequestAndOutOptions(flags);
  if (!options.ok) {
    return options;
  }
  return success({ name, file: file.value, ...revises, ...options.value });
}

/**
 * `preview FILE`: the file, then --request and --out; --mode and --revision were checked first.
 * Fails with `source-unavailable`, then `invalid-request`, then `output-unavailable`.
 */
export function buildPreviewCommand(
  operand: string,
  flags: CommandFlags,
  mode: ChangeMode,
  revises: Revises,
): Result<ServiceCommand> {
  const file = checkSourceFile(operand);
  if (!file.ok) {
    return file;
  }
  const options = checkRequestAndOutOptions(flags);
  if (!options.ok) {
    return options;
  }
  return success({
    name: 'preview',
    file: file.value,
    mode,
    ...revises,
    ...options.value,
  });
}

/**
 * `recipe admit FILE`: the file and its recipe header, then --request and --out. Fails with
 * `source-unavailable`, then `invalid-arguments` (the header), then `invalid-request`, then
 * `output-unavailable`.
 */
export function buildRecipeAdmitCommand(
  operand: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const source = checkRecipeSource(operand, flags);
  if (!source.ok) {
    return source;
  }
  const options = checkRequestAndOutOptions(flags);
  if (!options.ok) {
    return options;
  }
  return success({ name: 'recipe-admit', ...source.value, ...options.value });
}

/**
 * `recipe instantiate PIN`: the pin with --namespace, then --out. Fails with `invalid-arguments`,
 * then `output-unavailable`.
 */
export function buildRecipeInstantiateCommand(
  operand: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const expansion = checkExpansion(operand, flags.namespace);
  if (!expansion.ok) {
    return expansion;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'recipe-instantiate', expansion: expansion.value, ...outOption.value });
}

/**
 * `recipe admit`'s FILE, then its header flags. Fails with `source-unavailable`, then
 * `invalid-arguments`.
 */
function checkRecipeSource(
  operand: string,
  flags: CommandFlags,
): Result<RecipeSource> {
  const file = checkSourceFile(operand);
  if (!file.ok) {
    return file;
  }
  const recipe = checkRecipeHeader(flags);
  if (!recipe.ok) {
    return recipe;
  }
  return success({ file: file.value, recipe: recipe.value });
}

/** --request, then --out. Fails with `invalid-request`, then `output-unavailable`. */
function checkRequestAndOutOptions(flags: CommandFlags): Result<RequestAndOutOptions> {
  const requestOption = checkRequestOption(flags);
  if (!requestOption.ok) {
    return requestOption;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ ...requestOption.value, ...outOption.value });
}
