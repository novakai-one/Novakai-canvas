/*
 * Why this file exists
 *
 * A change is built once, then kept and sent exactly as built. For `replace plan.canvas`, the CLI
 * reads the file and the workspace, parses the source, and stores any fonts or images it names in
 * the service. An `apply` after a `preview` sends that same request; nothing is read again.
 *
 * This file does those steps, in that order, and gives back the request ready to keep and send.
 * It never sends the change. Each step gives back a `Result` (see `contract/errors.ts`).
 */
import { prepareResources } from '../resources/stage.js';
import type { ResourceDependencies } from '../resources/stage.js';
import { parseSource } from '../shared/parse-source.js';
import { buildChangeRequest, checkCollectionRecordId } from './change-request.js';
import type { ChangeDraft } from './change-request.js';
import { chooseRequestId } from './request-id.js';
import type { ChangeCommand, ChangeIntent, ChangeMode } from '../../contract/records/command.js';
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { SourceParser } from '../../contract/ports/source-parser.js';
import type { AuthoringRequest, WorkspaceSnapshot } from '../../contract/records/foreign.js';
import type { ServiceAnswer } from '../../contract/records/service-answers.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { CollectionRevision, ServiceGeneration } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/**
 * The tools preparing a change uses: the source file read, the workspace read, Language's parser,
 * Model's collection check, fresh request IDs, and font and image staging.
 */
export interface PrepareDependencies extends ResourceDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly reads: Pick<ServiceReads, 'workspace'>;
  readonly language: SourceParser;
  readonly collections: CollectionValidator;
  readonly requestIds: RequestIds;
}

/**
 * Builds the request for one change command, and stages the fonts and images its source names.
 * Gives back the request with copies of those bytes, in the form the journal keeps
 * (`RetainedRequest`). Nothing is kept or sent yet.
 * The mistakes it can find: the file or workspace can't be read, the source doesn't parse
 * (`invalid-source`), the change doesn't fit the workspace, or a font or image can't be staged.
 */
export async function prepareChangeRequest(
  command: ChangeCommand,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const source = await dependencies.files.readSource(command.file);
  if (!source.ok) {
    return source;
  }
  const workspace = await dependencies.reads.workspace();
  if (!workspace.ok) {
    return workspace;
  }
  return buildAndStage(command, source.value, workspace.value, dependencies);
}

/**
 * Builds the request from the source text and the workspace as read, then stages the fonts and
 * images the source names.
 */
async function buildAndStage(
  command: ChangeCommand,
  source: string,
  workspace: ServiceAnswer<WorkspaceSnapshot>,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const parsed = parseSource(dependencies.language, source);
  if (!parsed.ok) {
    return parsed;
  }
  const declaredId = parsed.value.collection;
  const request = buildCommandRequest(command, source, declaredId, workspace.value, dependencies);
  if (!request.ok) {
    return request;
  }
  const unstaged = keepWithoutBackups(request.value, workspace.generation);
  return prepareResources(command.file, parsed.value.resources, unstaged, dependencies);
}

/**
 * Builds the command's Authoring request for the collection the source declares, sent under the
 * typed `--request` or a fresh ID.
 */
function buildCommandRequest(
  command: ChangeCommand,
  source: string,
  declaredId: string,
  snapshot: WorkspaceSnapshot,
  dependencies: PrepareDependencies,
): Result<AuthoringRequest> {
  const intent = chooseIntent(command);
  const collection = checkCollectionRecordId(intent, declaredId);
  if (!collection.ok) {
    return collection;
  }
  const requestId = chooseRequestId(command, dependencies.requestIds);
  if (!requestId.ok) {
    return requestId;
  }
  const draft: ChangeDraft = {
    intent,
    collection: collection.value,
    source,
    request: requestId.value,
  };
  return buildChangeRequest(draft, snapshot, dependencies.collections);
}

/** Works out what Authoring must check first: `preview` by its `--mode`, the others by name. */
function chooseIntent(command: ChangeCommand): ChangeIntent {
  switch (command.name) {
    case 'create':
      return { mode: 'create' };
    case 'preview':
      return intentForMode(command.mode, command.revision);
    default:
      return intentForMode(command.name, command.revision);
  }
}

/** Builds the intent for a mode: `replace` and `patch` keep the revision if one was given. */
function intentForMode(
  mode: ChangeMode,
  revision: CollectionRevision | undefined,
): ChangeIntent {
  if (mode === 'create') {
    return { mode };
  }
  if (revision === undefined) {
    return { mode };
  }
  return { mode, revision };
}

/** Wraps the request as the journal keeps it: with the service's generation, no byte copies yet. */
function keepWithoutBackups(
  request: AuthoringRequest,
  generation: ServiceGeneration,
): RetainedRequest {
  return { generation, request, backups: [] };
}
