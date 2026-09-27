/*
 * DSL authoring submission: retain the request, restore its resource bytes, then send it to
 * Authoring preview or apply and turn the answer into text. Uses injected ports only. Authoring
 * owns the commit; an uncertain answer names the retained request so `receipt` then `retry`
 * recover it.
 */
import { restoreResources } from '../resources/restore.js';
import type { ResourcePoster } from '../resources/stage.js';
import { prepare } from './prepare.js';
import type { PrepareDependencies } from './prepare.js';
import type { ChangeCommand } from '../../contract/records/command.js';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { RequestId } from '../../contract/brands.js';
import type { CliFailure, Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';

/** What `submit` uses: the journal's save, the transport's POST and the apply-answer reader. */
export interface SubmitDependencies extends ResourcePoster {
  readonly journal: Pick<RequestJournal, 'save'>;
  readonly semantic: Pick<SemanticInputs, 'applied'>;
}

/**
 * Retention failure prevents a write because an uncertain result could not be reconciled safely
 * without the request. Fails as the journal save, the resource restore or the send does; a lost
 * answer names `receipt` then `retry` for the retained request.
 */
export async function submit(
  retained: RetainedRequest,
  preview: boolean,
  dependencies: SubmitDependencies,
): Promise<Result<string>> {
  const saved = await dependencies.journal.save(retained);
  if (!saved.ok) return saved;
  const restored = await restoreResources(retained.backups, dependencies);
  if (!restored.ok) return restored;
  return transmit(retained, preview, dependencies);
}
/** Transport receives only the canonical envelope, never local byte backups. */
async function transmit(
  retained: RetainedRequest,
  preview: boolean,
  dependencies: SubmitDependencies,
): Promise<Result<string>> {
  const route = preview ? '/api/v1/authoring/preview' : '/api/v1/authoring/apply';
  const answer = await dependencies.transport.post(route, {
    version: 1,
    generation: retained.generation,
    request: retained.request,
    preview,
  });
  if (!answer.ok) return unconfirmed(answer.error, retained.request.request);
  return confirmed(answer.value.value, retained.request.request, preview, dependencies);
}
/**
 * A lost or unreadable answer (`connection-uncertain`, `invalid-response`) names the retained
 * request instead of suggesting a new request ID. A service rejection is returned whole.
 */
function unconfirmed(
  error: CliFailure,
  id: RequestId,
): Result<never> {
  if (error.code === 'connection-uncertain' || error.code === 'invalid-response')
    return {
      ok: false,
      error: {
        ...error,
        recovery: `Run canvas receipt ${id}, then canvas retry ${id} only if no receipt exists.`,
      },
    };
  return { ok: false, error };
}
/** Preview prints reviewable owner output and a stable apply command; successful writes use the apply-answer reader. */
function confirmed(
  value: unknown,
  id: RequestId,
  preview: boolean,
  dependencies: Pick<SubmitDependencies, 'semantic'>,
): Result<string> {
  if (preview)
    return success(
      `Preview request ${id}\n${JSON.stringify(value, null, 2)}\nApply with: canvas apply ${id}`,
    );
  return dependencies.semantic.applied(value, id);
}
/** Agent authoring consumes readable source only. JSON envelopes and coordinates are never required user input. */
export async function author(
  command: ChangeCommand,
  dependencies: PrepareDependencies & SubmitDependencies,
): Promise<Result<string>> {
  const prepared = await prepare(command, dependencies);
  if (!prepared.ok) return prepared;
  return submit(prepared.value, command.name === 'preview', dependencies);
}
