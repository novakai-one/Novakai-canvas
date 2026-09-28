/*
 * DSL authoring preparation: read the source file and the workspace snapshot once, parse the
 * source once, build its Authoring request, then stage and freeze its declared resources. Uses
 * injected ports only; nothing is retained or sent to Authoring here. Failures are returned as
 * values; the caller fixes the named input and runs the command again.
 */
import { prepareResources } from '../resources/stage.js';
import type { ResourceDependencies } from '../resources/stage.js';
import { parseSource } from '../shared/parse-source.js';
import { changeRequest, collectionRecordId } from './change-request.js';
import { requestIdFor } from './request-id.js';
import type { ChangeCommand, ChangeIntent, ChangeMode } from '../../contract/records/command.js';
import type { CollectionReader } from '../../contract/ports/collection-reader.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { SourceLanguage } from '../../contract/ports/source-language.js';
import type { Request, Snapshot } from '../../contract/records/foreign.js';
import type { ServiceAnswer } from '../../contract/records/service-answers.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { CollectionRevision } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/**
 * What `prepare` uses: the source read, the workspace read, the parser, Model's collection check,
 * request IDs and resource staging.
 */
export interface PrepareDependencies extends ResourceDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly reads: Pick<ServiceReads, 'workspace'>;
  readonly language: SourceLanguage;
  readonly collections: CollectionReader;
  readonly requestIds: RequestIds;
}

/**
 * Capture source and observed versions once; neither preview nor apply refreshes the resulting
 * Authoring envelope. Fails as the source read, the workspace read, the parse, the request or
 * resource staging does; nothing is retained or sent to Authoring.
 */
export async function prepare(
  command: ChangeCommand,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const source = await dependencies.files.readSource(command.file);
  if (!source.ok) return source;
  const current = await dependencies.reads.workspace();
  if (!current.ok) return current;
  return prepareCaptured(command, source.value, current.value, dependencies);
}

/**
 * The request, then its resources. Resource preparation finishes before retention or submission.
 * Fails with `invalid-source`, as {@link requestOf} does, or as resource staging does.
 */
async function prepareCaptured(
  command: ChangeCommand,
  source: string,
  current: ServiceAnswer<Snapshot>,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const parsed = parseSource(dependencies.language, source);
  if (!parsed.ok) return parsed;
  const request = requestOf(command, source, parsed.value.collection, current.value, dependencies);
  if (!request.ok) return request;
  const retained = { generation: current.generation, request: request.value, backups: [] };
  return prepareResources(command.file, parsed.value.resources, retained, dependencies);
}

/**
 * The change's Authoring request under the given `--request` or a fresh ID, for the collection
 * the source declares. Fails as `collectionRecordId`, `requestIdFor` or `changeRequest` does.
 */
function requestOf(
  command: ChangeCommand,
  source: string,
  declared: string,
  snapshot: Snapshot,
  dependencies: PrepareDependencies,
): Result<Request> {
  const intent = intentOf(command);
  const collection = collectionRecordId(intent, declared);
  if (!collection.ok) return collection;
  const requestId = requestIdFor(command, dependencies.requestIds);
  if (!requestId.ok) return requestId;
  const draft = { intent, collection: collection.value, source, request: requestId.value };
  return changeRequest(draft, snapshot, dependencies.collections);
}

/** The preconditions the command asks for: preview by its --mode, the others by their name. */
function intentOf(command: ChangeCommand): ChangeIntent {
  switch (command.name) {
    case 'create':
      return { mode: 'create' };
    case 'preview':
      return intent(command.mode, command.revision);
    default:
      return intent(command.name, command.revision);
  }
}

/** `create` needs no revision; `replace` and `patch` keep the one the agent read, when given. */
function intent(
  mode: ChangeMode,
  revision: CollectionRevision | undefined,
): ChangeIntent {
  if (mode === 'create') return { mode };
  if (revision === undefined) return { mode };
  return { mode, revision };
}
