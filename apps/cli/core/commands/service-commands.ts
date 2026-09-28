/*
 * Why this file exists
 *
 * Most commands are sent to the local Canvas service, and each needs different values checked
 * first. In `pnpm canvas read my-diagram --out read.canvas`, `my-diagram` must be a valid
 * collection ID and `read.canvas` a usable path.
 *
 * This file has one `build…Command` function per kind of service command. Each checks the typed
 * values and builds its command's record. It never sends anything.
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
import type { FlagTextAsTyped } from './flags.js';
import { checkRecipeHeader, checkRecipeToInstantiate } from './recipe-values.js';
import {
  checkCollectionId,
  checkFilePath,
  checkOutOption,
  checkRequestId,
  checkRequestOption,
} from './values.js';

/** `recipe admit`'s FILE and the recipe header from its --id --version --family --title. */
interface RecipeSource {
  readonly file: FilePath;
  readonly recipe: RecipeHeader;
}

/** --request and --out, which every command that sends a DSL source or preset file accepts. */
type RequestAndOutOptions = RequestOption & OutOption;

/**
 * Builds `describe` or `list`. Neither has a word after it.
 *
 * The mistake it can find: an empty `--out` path.
 */
export function buildDescribeOrListCommand(
  name: 'describe' | 'list',
  flags: FlagTextAsTyped,
): Result<ServiceCommand> {
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name, ...outOption.value });
}

/**
 * Builds `read`: which collection to read, and which part of it (`scope`, already checked).
 *
 * `typedCollectionId` is the collection ID as typed, such as `my-diagram`.
 * The mistakes it can find: a collection ID that isn't valid, or an empty `--out` path.
 */
export function buildReadCommand(
  typedCollectionId: string,
  flags: FlagTextAsTyped,
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
 * Builds `inspect`, which reports whether a collection is valid, its warnings, and crossing lines.
 *
 * `typedCollectionId` is the collection ID as typed.
 * The mistakes it can find: a collection ID that isn't valid, or an empty `--out` path.
 */
export function buildInspectCommand(
  typedCollectionId: string,
  flags: FlagTextAsTyped,
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
 * Builds `receipt`, `retry` or `apply`, which act on a change sent earlier, named by request ID.
 *
 * `receipt req-1` shows whether it was saved, `retry` sends it again, `apply` saves a preview.
 * The mistakes it can find: a request ID that isn't valid, or an empty `--out` path.
 */
export function buildReceiptRetryOrApplyCommand(
  name: 'receipt' | 'retry' | 'apply',
  typedRequestId: string,
  flags: FlagTextAsTyped,
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
 * Builds `create` or `theme admit`, which send one file: a diagram to create, or a theme to save.
 *
 * `typedFilePath` is the file's path as typed.
 * The mistakes it can find: an empty file path, a bad `--request` ID, or an empty `--out` path.
 */
export function buildCreateOrThemeAdmitCommand(
  name: 'create' | 'theme-admit',
  typedFilePath: string,
  flags: FlagTextAsTyped,
): Result<ServiceCommand> {
  const file = checkFilePath(typedFilePath);
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
 * Builds `replace` or `patch`, which send a file that changes a collection.
 *
 * `typedFilePath` is the path as typed. `revisionOption` is the `--revision`, already checked.
 * The mistakes it can find: an empty file path, a bad `--request` ID, or an empty `--out` path.
 */
export function buildReplaceOrPatchCommand(
  name: 'replace' | 'patch',
  typedFilePath: string,
  flags: FlagTextAsTyped,
  revisionOption: RevisionOption,
): Result<ServiceCommand> {
  const file = checkFilePath(typedFilePath);
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
 * Builds `preview`, which shows what a file would change without saving it.
 *
 * `mode` (`--mode`) and `revisionOption` (`--revision`) are already checked.
 * The mistakes it can find: an empty file path, a bad `--request` ID, or an empty `--out` path.
 */
export function buildPreviewCommand(
  typedFilePath: string,
  flags: FlagTextAsTyped,
  mode: ChangeMode,
  revisionOption: RevisionOption,
): Result<ServiceCommand> {
  const file = checkFilePath(typedFilePath);
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
 * Builds `recipe admit`, which saves a diagram file as a recipe to start new diagrams from.
 *
 * The mistakes it can find: an empty file path, a missing or bad recipe flag (`--id`, `--version`,
 * `--family`, `--title`), a bad `--request` ID, or an empty `--out` path.
 */
export function buildRecipeAdmitCommand(
  typedFilePath: string,
  flags: FlagTextAsTyped,
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
 * Builds `recipe instantiate`, which turns a saved recipe into diagram text.
 *
 * `typedPin` is the exact recipe as typed, such as `er@1.0.0#sha256:DIGEST`.
 * The mistakes it can find: a bad pin or `--namespace`, or an empty `--out` path.
 */
export function buildRecipeInstantiateCommand(
  typedPin: string,
  flags: FlagTextAsTyped,
): Result<ServiceCommand> {
  const expansion = checkRecipeToInstantiate(typedPin, flags.namespace);
  if (!expansion.ok) {
    return expansion;
  }
  const outOption = checkOutOption(flags);
  if (!outOption.ok) {
    return outOption;
  }
  return success({ name: 'recipe-instantiate', expansion: expansion.value, ...outOption.value });
}

/** Checks `recipe admit`'s file path, then its four recipe flags. */
function checkRecipeSource(
  fileText: string,
  flags: FlagTextAsTyped,
): Result<RecipeSource> {
  const file = checkFilePath(fileText);
  if (!file.ok) {
    return file;
  }
  const recipe = checkRecipeHeader(flags);
  if (!recipe.ok) {
    return recipe;
  }
  return success({ file: file.value, recipe: recipe.value });
}

/** Checks `--request`, then `--out`. */
function checkRequestAndOutOptions(flags: FlagTextAsTyped): Result<RequestAndOutOptions> {
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
