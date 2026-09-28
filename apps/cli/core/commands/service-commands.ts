/*
 * Why this file exists
 *
 * Most commands are sent to the local Canvas service, and each needs different values. `read`
 * needs a collection ID. `receipt` needs a request ID. `create` needs a file. Take
 * `pnpm canvas read my-diagram --out read.canvas`: before it is sent, `my-diagram` has to be a
 * valid collection ID, and `read.canvas` a usable path.
 *
 * This file has one builder per kind of service command. Each checks the word typed after the
 * command, then the command's own flags, then `--request` and `--out`. It returns a
 * `ServiceCommand` with only the fields that command uses.
 *
 * It never sends anything. `assembly.ts` has already checked `--section`, `--object`, `--mode` and
 * `--revision`, and passes in the ones a command uses. Each check answers with a `Result` (see
 * `contract/errors.ts`). The checks, and the mistakes they report, are in `values.ts` and
 * `recipe-values.ts`.
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
import { checkExpansionRequest, checkRecipeHeader } from './recipe-values.js';
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
type RequestAndOutOptions = RequestOption & OutOption;

/**
 * Builds `describe` or `list`. Neither has a word after it; each takes only `--out`.
 *
 * The mistake it can find: an empty `--out` path.
 */
export function buildDescribeOrListCommand(
  name: 'describe' | 'list',
  flags: CommandFlags,
): Result<ServiceCommand> {
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name, ...outOption.value });
}

/**
 * Builds `read`: which collection to read, and which part of it (`scope`, already checked).
 * `typedCollectionId` is the collection ID as typed, such as `my-diagram`.
 *
 * The mistakes it can find: a collection ID that isn't valid, then an empty `--out` path.
 */
export function buildReadCommand(
  typedCollectionId: string,
  flags: CommandFlags,
  scope: ReadScope,
): Result<ServiceCommand> {
  const collection = checkCollectionId(typedCollectionId);
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
 * Builds `inspect`, which reports on a collection's diagram: whether it is valid, its warnings,
 * and how many wires cross. `typedCollectionId` is the collection ID as typed.
 *
 * The mistakes it can find: a collection ID that isn't valid, then an empty `--out` path.
 */
export function buildInspectCommand(
  typedCollectionId: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const collection = checkCollectionId(typedCollectionId);
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
 * Builds `receipt`, `retry` or `apply`. Each acts on a request sent earlier, named by the request
 * ID typed after it: `pnpm canvas receipt req-1`. `typedRequestId` is that ID as typed.
 *
 * The mistakes it can find: a request ID that isn't valid, then an empty `--out` path.
 */
export function buildReceiptRetryOrApplyCommand(
  name: 'receipt' | 'retry' | 'apply',
  typedRequestId: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const request = checkRequestId(typedRequestId);
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
 * Builds `create` or `theme admit`. Each sends one file: a diagram to create, or a theme to save.
 * `typedFilePath` is the file's path as typed.
 *
 * The mistakes it can find: an empty file path, then a bad `--request` ID, then an empty `--out`
 * path.
 */
export function buildCreateOrThemeAdmitCommand(
  name: 'create' | 'theme-admit',
  typedFilePath: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const file = checkSourceFile(typedFilePath);
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
 * Builds `replace` or `patch`. Each sends a file that changes a collection, with the revision the
 * agent last read (`revisionOption`, already checked). `typedFilePath` is the file's path as typed.
 *
 * The mistakes it can find: an empty file path, then a bad `--request` ID, then an empty `--out`
 * path.
 */
export function buildReplaceOrPatchCommand(
  name: 'replace' | 'patch',
  typedFilePath: string,
  flags: CommandFlags,
  revisionOption: RevisionOption,
): Result<ServiceCommand> {
  const file = checkSourceFile(typedFilePath);
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
 * Builds `preview`, which shows what a file would change without saving it. `mode` and
 * `revisionOption` were already checked. `typedFilePath` is the file's path as typed.
 *
 * The mistakes it can find: an empty file path, then a bad `--request` ID, then an empty `--out`
 * path.
 */
export function buildPreviewCommand(
  typedFilePath: string,
  flags: CommandFlags,
  mode: ChangeMode,
  revisionOption: RevisionOption,
): Result<ServiceCommand> {
  const file = checkSourceFile(typedFilePath);
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
 * Builds `recipe admit`, which saves a diagram file as a reusable recipe. `typedFilePath` is the
 * file's path as typed.
 *
 * The mistakes it can find: an empty file path, then a missing or bad recipe flag (`--id`,
 * `--version`, `--family`, `--title`), then a bad `--request` ID, then an empty `--out` path.
 */
export function buildRecipeAdmitCommand(
  typedFilePath: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const source = checkRecipeSource(typedFilePath, flags);
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
 * Builds `recipe instantiate`, which turns a saved recipe into diagram text. `typedPin` is the
 * exact recipe as typed, such as `er@1.0.0#sha256:DIGEST`.
 *
 * The mistakes it can find: a bad pin or `--namespace`, then an empty `--out` path.
 */
export function buildRecipeInstantiateCommand(
  typedPin: string,
  flags: CommandFlags,
): Result<ServiceCommand> {
  const expansion = checkExpansionRequest(typedPin, flags.namespace);
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
