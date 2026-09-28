/*
 * DSL authoring submission: retain the request, restore its resource bytes, then send it to
 * Authoring preview or apply and turn the answer into text. Uses injected ports only. Authoring
 * owns the commit; an unconfirmed answer names the retained request so `receipt` then `retry`
 * recover it.
 */
import { restoreResources } from '../resources/restore.js';
import type { RestoreDependencies } from '../resources/restore.js';
import { matchedReceipt } from '../reads/receipt.js';
import { prepare } from './prepare.js';
import type { PrepareDependencies } from './prepare.js';
import type { ChangeCommand } from '../../contract/records/command.js';
import type { ServiceAuthoring } from '../../contract/ports/service-authoring.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { SubmitMode } from '../../contract/records/service-answers.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { unsupported } from '../shared/results.js';

/** What `submit` uses: the journal's save, the byte restore and Authoring's preview and apply. */
export interface SubmitDependencies extends RestoreDependencies {
  readonly journal: Pick<RequestJournal, 'save'>;
  readonly authoring: ServiceAuthoring;
}

/** What `authorSource` uses: what `prepare` uses and what `submit` uses. */
export type AuthorDependencies = PrepareDependencies & SubmitDependencies;

/**
 * Agent authoring consumes readable source only; JSON envelopes and coordinates are never user
 * input. `preview` sends to preview, the other change commands apply. Fails as `prepare` or
 * `submit` does.
 */
export async function authorSource(
  command: ChangeCommand,
  dependencies: AuthorDependencies,
): Promise<Result<string>> {
  const prepared = await prepare(command, dependencies);
  if (!prepared.ok) return prepared;
  return submit(prepared.value, modeOf(command), dependencies);
}

/**
 * Retention failure prevents a write because an uncertain result could not be reconciled safely
 * without the request. Fails as the journal save, the resource restore or the send does; a lost
 * answer names `receipt` then `retry` for the retained request.
 */
export async function submit(
  retained: RetainedRequest,
  mode: SubmitMode,
  dependencies: SubmitDependencies,
): Promise<Result<string>> {
  const saved = await dependencies.journal.save(retained);
  if (!saved.ok) return saved;
  const restored = await restoreResources(retained.backups, dependencies);
  if (!restored.ok) return restored;
  return send(retained, mode, dependencies.authoring);
}

/** `preview` previews; `create`, `replace` and `patch` apply. */
function modeOf(command: ChangeCommand): SubmitMode {
  if (command.name === 'preview') return 'preview';
  return 'apply';
}

/** The retained request to the mode's Authoring call; only the canonical envelope is sent. */
function send(
  retained: RetainedRequest,
  mode: SubmitMode,
  authoring: ServiceAuthoring,
): Promise<Result<string>> {
  switch (mode) {
    case 'preview':
      return previewed(retained, authoring);
    case 'apply':
      return applied(retained, authoring);
    default:
      return Promise.resolve(unsupported(mode));
  }
}

/** Reviewable owner output and the stable command that applies it. Fails as the preview does. */
async function previewed(
  retained: RetainedRequest,
  authoring: ServiceAuthoring,
): Promise<Result<string>> {
  const id = retained.request.request;
  const answer = await authoring.preview(retained);
  if (!answer.ok) return answer;
  return success(
    `Preview request ${id}\n${JSON.stringify(answer.value, null, 2)}\nApply with: canvas apply ${id}`,
  );
}

/**
 * The committed receipt of this request. Fails as the apply does (`invalid-response` when the
 * answer carries no receipt), or with `invalid-response` for a receipt of another request.
 */
async function applied(
  retained: RetainedRequest,
  authoring: ServiceAuthoring,
): Promise<Result<string>> {
  const receipt = await authoring.apply(retained);
  if (!receipt.ok) return receipt;
  return matchedReceipt(receipt.value, retained.request.request);
}
