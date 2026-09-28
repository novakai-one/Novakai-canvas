/*
 * Why this file exists
 *
 * Sending a change safely takes more than one call. If the answer to `create plan.canvas` is lost,
 * the agent must be able to look up its receipt and retry the very same request. So the request is
 * written to the journal first. Its font and image bytes are then stored in the service again, in
 * case it restarted. Only then is the request sent.
 *
 * This file runs those steps, in that order, for every change and every retry. Authoring, not this
 * file, saves the change. Each step gives back a `Result` (see `contract/errors.ts`).
 */
import { restoreResources } from '../resources/restore.js';
import type { RestoreDependencies } from '../resources/restore.js';
import { formatReceipt } from '../reads/receipt.js';
import { prepareChangeRequest } from './prepare.js';
import type { PrepareDependencies } from './prepare.js';
import type { ChangeCommand } from '../../contract/records/command.js';
import type { ServiceAuthoring } from '../../contract/ports/service-authoring.js';
import type { RequestJournal } from '../../contract/ports/request-journal.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { SubmitMode } from '../../contract/records/service-answers.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { unsupported } from '../shared/results.js';

/** The tools sending uses: the journal, the font and image restore, and Authoring's two calls. */
export interface SubmitDependencies extends RestoreDependencies {
  readonly journal: Pick<RequestJournal, 'save'>;
  readonly authoring: ServiceAuthoring;
}

/** The tools a source change uses: the tools for preparing it and the tools for sending it. */
export type SourceChangeDependencies = PrepareDependencies & SubmitDependencies;

/**
 * Runs `create`, `replace`, `patch` or `preview` for a source file: prepares the request, then
 * sends it. `preview` asks what would change; the others save. Gives back the text to print.
 * The mistakes it can find are those of `prepareChangeRequest` and `submitRequest`.
 */
export async function sendSourceChange(
  command: ChangeCommand,
  dependencies: SourceChangeDependencies,
): Promise<Result<string>> {
  const prepared = await prepareChangeRequest(command, dependencies);
  if (!prepared.ok) return prepared;
  return submitRequest(prepared.value, modeOf(command), dependencies);
}

/**
 * Keeps `retained` in the journal, stores its font and image bytes again, then sends it to preview
 * or apply. Gives back the text to print: the preview, or the receipt.
 * The mistakes it can find: it can't be kept (then it is never sent), its bytes can't be stored,
 * or the send fails. A lost answer's advice is to run `receipt`, then `retry`.
 */
export async function submitRequest(
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
  return formatReceipt(receipt.value, retained.request.request);
}
