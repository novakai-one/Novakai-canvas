/*
 * One builder per service command: the operand is checked first, then the command's own flags,
 * then --request and --out. Pure. `assembly.ts` checks the read scope, --mode and --revision
 * before any builder runs, and passes in the ones a command carries. A rejected value is a failure
 * naming the argument; nothing was read or sent, so the caller corrects it and runs the command
 * again.
 */
import type {
  ChangeMode,
  OutOption,
  ReadScope,
  RecipeHeader,
  RequestOption,
  RevisionOption,
  ServiceCommand,
} from '../../contract/records/command.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import type { CommandFlags } from './flags.js';
import { checkPinAndNamespace, checkRecipeHeader } from './recipe-values.js';
import {
  checkCollectionId,
  checkOutOption,
  checkRequestId,
  checkRequestOption,
  checkSourceFile,
} from './values.js';

/** The commands that take no operand and only --out: `describe` and `list`. */
type AnswerOnlyCommandName = 'describe' | 'list';

/** The commands whose operand is a request ID. */
type RequestCommandName = 'receipt' | 'retry' | 'apply';

/** The commands that send one FILE with no revision: a DSL source, or a theme config. */
type FileCommandName = 'create' | 'theme-admit';

/** The commands whose FILE Authoring checks against the --revision the agent read. */
type RevisionCheckedCommandName = 'replace' | 'patch';

/** `recipe admit`'s FILE and the recipe header from its --id --version --family --title. */
interface RecipeSource {
  readonly file: FilePath;
  readonly recipe: RecipeHeader;
}

/** --request and --out, which every command that sends a DSL source or preset file takes. */
type RequestAndOutOptions = RequestOption & OutOption;

/** `describe` or `list`: --out only. Fails with `output-unavailable` (an empty --out). */
export function buildAnswerOnlyCommand(
  name: AnswerOnlyCommandName,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name, ...outOption.value });
}

/**
 * `read ID`: the collection ID, then --out; the read scope was checked first. Fails with
 * `invalid-arguments`, then `output-unavailable`.
 */
export function buildReadCommand(
  collectionText: string,
  flags: CommandFlags,
  scope: ReadScope,
): Result<ServiceCommand> {
  const collection = checkCollectionId(collectionText);
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
  collectionText: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const collection = checkCollectionId(collectionText);
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
  name: RequestCommandName,
  requestText: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const request = checkRequestId(requestText);
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
export function buildFileCommand(
  name: FileCommandName,
  fileText: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const file = checkSourceFile(fileText);
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
export function buildRevisionCheckedCommand(
  name: RevisionCheckedCommandName,
  fileText: string,
  flags: CommandFlags,
  revisionOption: RevisionOption,
): Result<ServiceCommand> {
  const file = checkSourceFile(fileText);
  if (!file.ok) {
    return file;
  }
  const options = checkRequestAndOutOptions(flags);
  if (!options.ok) {
    return options;
  }
  return success({ name, file: file.value, ...revisionOption, ...options.value });
}

/**
 * `preview FILE`: the file, then --request and --out; --mode and --revision were checked first.
 * Fails with `source-unavailable`, then `invalid-request`, then `output-unavailable`.
 */
export function buildPreviewCommand(
  fileText: string,
  flags: CommandFlags,
  mode: ChangeMode,
  revisionOption: RevisionOption,
): Result<ServiceCommand> {
  const file = checkSourceFile(fileText);
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
    ...revisionOption,
    ...options.value,
  });
}

/**
 * `recipe admit FILE`: the file and its recipe header, then --request and --out. Fails with
 * `source-unavailable`, then `invalid-arguments` (the header), then `invalid-request`, then
 * `output-unavailable`.
 */
export function buildRecipeAdmitCommand(
  fileText: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const source = checkRecipeSource(fileText, flags);
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
  pinText: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const expansion = checkPinAndNamespace(pinText, flags.namespace);
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
  fileText: string,
  flags: CommandFlags,
): Result<RecipeSource> {
  const file = checkSourceFile(fileText);
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
