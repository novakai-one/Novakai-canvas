/*
 * DSL authoring preparation: read the source file and the workspace snapshot once, build the
 * Authoring request, then stage and freeze its declared resources. Uses injected ports only;
 * nothing is retained or sent to Authoring here. Failures are returned as values; the caller fixes
 * the named input and runs the command again.
 */
import { prepareResources } from '../resources/stage.js';
import type { ChangeCommand, ChangeIntent, ChangeMode } from '../../contract/records/command.js';
import type { CliDependencies, RequestDraft, ServiceAnswer } from '../../contract/ports/runtime.js';
import type { Snapshot } from '../../contract/records/foreign.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { CollectionRevision, Generation } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { rejected, success } from '../../contract/errors.js';

/** Capture source and observed versions once; neither preview nor apply refreshes the resulting Authoring envelope. */
export async function prepare(
  command: ChangeCommand,
  dependencies: CliDependencies,
): Promise<Result<RequestDraft>> {
  const source = await dependencies.files.source(command.file);
  if (!source.ok) return source;
  const current = await dependencies.transport.get('/api/v1/workspace');
  if (!current.ok) return current;
  return prepareCaptured(command, source.value, current.value, dependencies);
}
/** Capture and resource preparation finish before retention or canonical submission. */
async function prepareCaptured(
  command: ChangeCommand,
  source: SourceFile,
  current: ServiceAnswer,
  dependencies: CliDependencies,
): Promise<Result<RequestDraft>> {
  const draft = captured(command, source.source, current, dependencies);
  if (!draft.ok) return draft;
  return prepareResources(source, draft.value, dependencies);
}
/** Owner readers give transported snapshots their type before request construction. */
function captured(
  command: ChangeCommand,
  source: string,
  current: ServiceAnswer,
  dependencies: CliDependencies,
): Result<RequestDraft> {
  if (!current.outcome.ok) return rejected('service-rejected', current.outcome.error);
  const snapshot = dependencies.semantic.snapshot(current.outcome.value);
  if (!snapshot.ok) return snapshot;
  return draft(command, source, snapshot.value, current.generation, dependencies);
}
/** An explicit ID supports scripted receipt lookup; generated IDs are persisted before any network submission. */
function draft(
  command: ChangeCommand,
  source: string,
  snapshot: Snapshot,
  generation: Generation,
  dependencies: CliDependencies,
): Result<RequestDraft> {
  const request = dependencies.semantic.request(
    intentOf(command),
    source,
    snapshot,
    command.request ?? dependencies.nextRequestId(),
  );
  if (!request.ok) return request;
  return success({ generation, request: request.value, backups: [] });
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
