/*
 * DSL authoring preparation: read the source file and the workspace snapshot once, build the
 * Authoring request, then stage and freeze its declared resources. Uses injected ports only;
 * nothing is retained or sent to Authoring here. Failures are returned as values; the caller fixes
 * the named input and runs the command again.
 */
import { prepareResources } from '../resources/stage.js';
import type { ResourceDependencies } from '../resources/stage.js';
import type { ChangeCommand, ChangeIntent, ChangeMode } from '../../contract/records/command.js';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { HttpTransport } from '../../contract/ports/http-transport.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { Observed } from '../../contract/records/service-answers.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { CollectionRevision, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/**
 * What `prepare` uses: the source read, the workspace read, request IDs, and the request and
 * resource staging readers.
 */
export interface PrepareDependencies extends ResourceDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly transport: HttpTransport;
  readonly semantic: Pick<
    SemanticInputs,
    'snapshot' | 'request' | 'requests' | 'admissionDigest' | 'backup' | 'checkedRequest'
  >;
  nextRequestId(): RequestId;
}

/**
 * Capture source and observed versions once; neither preview nor apply refreshes the resulting
 * Authoring envelope. Fails as the source read, the workspace read, the request reader or
 * resource staging does; nothing is retained or sent to Authoring.
 */
export async function prepare(
  command: ChangeCommand,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const source = await dependencies.files.readSource(command.file);
  if (!source.ok) return source;
  const current = await dependencies.transport.get('/api/v1/workspace');
  if (!current.ok) return current;
  return prepareCaptured(
    command,
    { file: command.file, source: source.value },
    current.value,
    dependencies,
  );
}
/**
 * Owner readers give the transported snapshot its type; an explicit ID supports scripted receipt
 * lookup, a generated one is retained before any submission. Resource preparation finishes before
 * retention or canonical submission.
 */
async function prepareCaptured(
  command: ChangeCommand,
  source: SourceFile,
  current: Observed<unknown>,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const snapshot = dependencies.semantic.snapshot(current.value);
  if (!snapshot.ok) return snapshot;
  const request = dependencies.semantic.request(
    intentOf(command),
    source.source,
    snapshot.value,
    command.request ?? dependencies.nextRequestId(),
  );
  if (!request.ok) return request;
  const retained = { generation: current.generation, request: request.value, backups: [] };
  return prepareResources(source, retained, dependencies);
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
