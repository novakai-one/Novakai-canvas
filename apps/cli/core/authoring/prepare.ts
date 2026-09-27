/*
 * DSL authoring preparation: read the source file and the workspace snapshot once, build the
 * Authoring request, then stage and freeze its declared resources. Uses injected ports only;
 * nothing is retained or sent to Authoring here. Failures are returned as values; the caller fixes
 * the named input and runs the command again.
 */
import { prepareResources } from '../resources/stage.js';
import type { ResourceDependencies } from '../resources/stage.js';
import type { ChangeCommand, ChangeIntent, ChangeMode } from '../../contract/records/command.js';
import type { ChangeInputs } from '../../contract/ports/runtime.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { Snapshot } from '../../contract/records/foreign.js';
import type { Observed } from '../../contract/records/service-answers.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { CollectionRevision, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';

/**
 * What `prepare` uses: the source read, the workspace read, request IDs, the request builder and
 * resource staging.
 */
export interface PrepareDependencies extends ResourceDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly reads: Pick<ServiceReads, 'workspace'>;
  readonly semantic: ChangeInputs;
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
  const current = await dependencies.reads.workspace();
  if (!current.ok) return current;
  return prepareCaptured(
    command,
    { file: command.file, source: source.value },
    current.value,
    dependencies,
  );
}
/**
 * An explicit ID supports scripted receipt lookup, a generated one is retained before any
 * submission. Resource preparation finishes before retention or canonical submission.
 */
async function prepareCaptured(
  command: ChangeCommand,
  source: SourceFile,
  current: Observed<Snapshot>,
  dependencies: PrepareDependencies,
): Promise<Result<RetainedRequest>> {
  const request = dependencies.semantic.request(
    intentOf(command),
    source.source,
    current.value,
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
