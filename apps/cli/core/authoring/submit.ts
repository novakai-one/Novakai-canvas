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
import type { ChangePreview, SubmitMode } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
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
  if (!prepared.ok) {
    return prepared;
  }
  const mode = chooseSubmitMode(command);
  return submitRequest(prepared.value, mode, dependencies);
}

/**
 * Writes `prepared` to the journal, stores its font and image bytes again, then sends it to
 * preview or apply. Gives back the text to print: the preview, or the receipt.
 * The mistakes it can find: it can't be written (then it is never sent), its bytes can't be
 * stored, or the send fails. If the answer is lost, the failure tells the agent to run `receipt`,
 * then `retry`.
 */
export async function submitRequest(
  prepared: RetainedRequest,
  mode: SubmitMode,
  dependencies: SubmitDependencies,
): Promise<Result<string>> {
  const saved = await dependencies.journal.save(prepared);
  if (!saved.ok) {
    return saved;
  }
  const restored = await restoreResources(prepared.backups, dependencies);
  if (!restored.ok) {
    return restored;
  }
  return sendToAuthoring(prepared, mode, dependencies.authoring);
}

/** Chooses how the change is sent: `preview` previews; `create`, `replace` and `patch` apply. */
function chooseSubmitMode(command: ChangeCommand): SubmitMode {
  if (command.name === 'preview') {
    return 'preview';
  }
  return 'apply';
}

/** Sends the kept request to Authoring's preview or apply call, as `mode` says. */
function sendToAuthoring(
  retained: RetainedRequest,
  mode: SubmitMode,
  authoring: ServiceAuthoring,
): Promise<Result<string>> {
  switch (mode) {
    case 'preview':
      return previewChange(retained, authoring);
    case 'apply':
      return applyChange(retained, authoring);
    default:
      return Promise.resolve(unsupported(mode));
  }
}

/** Asks Authoring what the change would do, and gives back that preview as text to print. */
async function previewChange(
  retained: RetainedRequest,
  authoring: ServiceAuthoring,
): Promise<Result<string>> {
  const preview = await authoring.preview(retained);
  if (!preview.ok) {
    return preview;
  }
  const previewText = formatPreview(preview.value, retained.request.request);
  return success(previewText);
}

/** Writes the preview as JSON, between the request's ID and the command that applies it. */
function formatPreview(
  preview: ChangePreview,
  request: RequestId,
): string {
  const previewJson = JSON.stringify(preview, null, 2);
  return `Preview request ${request}\n${previewJson}\nApply with: canvas apply ${request}`;
}

/** Asks Authoring to save the change, and gives back its receipt once it is for this request. */
async function applyChange(
  retained: RetainedRequest,
  authoring: ServiceAuthoring,
): Promise<Result<string>> {
  const receipt = await authoring.apply(retained);
  if (!receipt.ok) {
    return receipt;
  }
  return formatReceipt(receipt.value, retained.request.request);
}
