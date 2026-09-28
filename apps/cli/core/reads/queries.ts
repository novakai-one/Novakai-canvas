/*
 * Why this file exists
 *
 * Before an agent changes a diagram, it looks. `pnpm canvas list` shows the collections, and
 * `pnpm canvas read my-diagram` prints one as `.canvas` text it can edit.
 *
 * This file runs the five commands that only look: `describe`, `list`, `read`, `inspect` and
 * `receipt`. Each asks the service one question and answers with a `Result` (see
 * `contract/errors.ts`): the text to print, or the service's failure unchanged. The service may
 * not answer (`connection-uncertain`), may send an answer that makes no sense, or may say no.
 * None of these commands changes the workspace.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ReadScope } from '../../contract/records/command.js';
import type { InspectionReport } from '../../contract/records/foreign.js';
import type { LanguageDescription } from '../../contract/records/service-answers.js';
import type { CollectionId, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { formatCollectionList } from './collections.js';
import { formatReceiptLookup } from './receipt.js';
import { formatReadAnswer } from './source.js';

/** The tools the look-only commands use. */
export interface ReadDependencies {
  /** The questions the CLI asks the service (`ports/service-reads.ts`). */
  readonly reads: ServiceReads;
  /** Model's check of a saved collection, so `list` can mark one that isn't valid. */
  readonly collections: CollectionValidator;
}

/**
 * Asks the service for the DSL vocabulary, and gives it back as JSON text for `describe`.
 * Fails as the service question fails.
 */
export async function describeLanguage(dependencies: ReadDependencies): Promise<Result<string>> {
  const vocabulary = await dependencies.reads.vocabulary();
  if (!vocabulary.ok) {
    return vocabulary;
  }
  const vocabularyText = jsonText(vocabulary.value);
  return success(vocabularyText);
}

/**
 * Lists the workspace's collections, one line each, as the text `list` prints.
 * A collection Model finds invalid is listed as invalid, never hidden.
 * Fails as the service question fails.
 */
export async function listCollections(dependencies: ReadDependencies): Promise<Result<string>> {
  const workspaceAnswer = await dependencies.reads.workspace();
  if (!workspaceAnswer.ok) {
    return workspaceAnswer;
  }
  // The answer also names the service's generation, which `list` doesn't print.
  const snapshot = workspaceAnswer.value.value;
  const collectionList = formatCollectionList(snapshot, dependencies.collections);
  return success(collectionList);
}

/**
 * Reads one collection's `.canvas` text, or only the section or object `scope` names, for `read`.
 * A comment on top names the revision, such as `# my-diagram revision=3`.
 * Fails as the service question fails.
 */
export async function readCollection(
  collection: CollectionId,
  scope: ReadScope,
  dependencies: ReadDependencies,
): Promise<Result<string>> {
  const readAnswer = await dependencies.reads.source(collection, scope);
  if (!readAnswer.ok) {
    return readAnswer;
  }
  const sourceText = formatReadAnswer(readAnswer.value);
  return success(sourceText);
}

/**
 * Asks the service for its report on one collection's layout, as JSON text for `inspect`.
 * Fails as the service question fails.
 */
export async function inspectCollection(
  collection: CollectionId,
  dependencies: ReadDependencies,
): Promise<Result<string>> {
  const report = await dependencies.reads.inspect(collection);
  if (!report.ok) {
    return report;
  }
  const reportText = jsonText(report.value);
  return success(reportText);
}

/**
 * Looks up whether `request` was saved, and gives back the text `receipt` prints.
 * `No committed receipt found.` is an answer, not a mistake.
 * Fails as the service question fails, or with `invalid-response` for another request's receipt.
 */
export async function readReceipt(
  request: RequestId,
  dependencies: ReadDependencies,
): Promise<Result<string>> {
  const receiptAnswer = await dependencies.reads.receipt(request);
  if (!receiptAnswer.ok) {
    return receiptAnswer;
  }
  // The answer also names the service's generation, which `receipt` doesn't print.
  const lookup = receiptAnswer.value.value;
  return formatReceiptLookup(lookup, request);
}

/**
 * Writes the vocabulary or a layout report as JSON text, indented by two spaces. Only these look-only
 * answers print as JSON; agents still write diagrams as `.canvas` text.
 */
function jsonText(answer: LanguageDescription | InspectionReport): string {
  return JSON.stringify(answer, null, 2);
}
