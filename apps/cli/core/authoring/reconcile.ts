/*
 * `retry` and `apply`: read the retained request, look up its receipt first, and replay the
 * identical Authoring request only when no receipt exists. Uses injected ports only. Authoring owns
 * the commit; the retained request file is the CLI's recovery record.
 */
import { submit } from './submit.js';
import type { Command } from '../../contract/records/command.js';
import type { CliDependencies, RequestDraft } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';

/** Replay checks for a completed receipt first. A restarted host receives the identical Authoring request under its new transport generation. */
export async function retry(
  command: Command,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const retained = await dependencies.files.read(command.target);
  if (!retained.ok) return retained;
  const receipt = await dependencies.transport.get(
    `/api/v1/receipt?id=${encodeURIComponent(command.target)}`,
  );
  if (!receipt.ok) return receipt;
  return reconciled(retained.value, receipt.value, dependencies);
}
/** Receipt absence permits explicit caller-requested replay; changed Authoring preconditions remain rejected by the owner. */
async function reconciled(
  draft: RequestDraft,
  response: import('../../contract/records/foreign.js').TransportResponse,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  if (!response.outcome.ok) return response.outcome;
  if (response.outcome.value !== null)
    return dependencies.semantic.receipt(response.outcome.value, {
      kind: 'committed',
      request: draft.request.request,
    });
  return submit({ ...draft, generation: response.generation }, false, dependencies);
}
