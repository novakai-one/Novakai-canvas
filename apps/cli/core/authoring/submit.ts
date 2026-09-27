/*
 * DSL authoring submission: retain the request, restore its resource bytes, then send it to
 * Authoring preview or apply and turn the answer into text. Uses injected ports only. Authoring
 * owns the commit; an uncertain answer names the retained request so `receipt` then `retry`
 * recover it.
 */
import { restoreResources } from '../resources/restore.js';
import { prepare } from './prepare.js';
import type { Command } from '../../contract/records/command.js';
import type { CliDependencies, RequestDraft } from '../../contract/ports/runtime.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { rejected, success } from '../../contract/errors.js';

/** Retention failure prevents a write because an uncertain result could not be reconciled safely without the request. */
export async function submit(
  draft: RequestDraft,
  preview: boolean,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const saved = await dependencies.files.save(draft);
  if (!saved.ok) return saved;
  const restored = await restoreResources(draft, dependencies);
  if (!restored.ok) return restored;
  return transmit(draft, preview, dependencies);
}
/** Transport receives only the canonical envelope, never local byte backups. */
async function transmit(
  draft: RequestDraft,
  preview: boolean,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const path = preview ? '/api/v1/authoring/preview' : '/api/v1/authoring/apply';
  const outcome = await dependencies.transport.post(path, {
    version: 1,
    generation: draft.generation,
    request: draft.request,
    preview,
  });
  return submitted(outcome, draft.request.request, preview, dependencies);
}
/** Network uncertainty names the retained request instead of suggesting a new request ID. */
function submitted(
  result: Result<import('../../contract/records/foreign.js').TransportResponse, LocalFailure>,
  id: string,
  preview: boolean,
  dependencies: CliDependencies,
): Result<string> {
  if (!result.ok)
    return {
      ok: false,
      error: {
        ...result.error,
        recovery: `Run canvas receipt ${id}, then canvas retry ${id} only if no receipt exists.`,
      },
    };
  if (!result.value.outcome.ok) return rejected('service-rejected', result.value.outcome.error);
  return confirmed(result.value.outcome.value, id, preview, dependencies);
}
/** Preview prints reviewable owner output and a stable apply command; successful writes use the apply-answer reader. */
function confirmed(
  value: unknown,
  id: string,
  preview: boolean,
  dependencies: CliDependencies,
): Result<string> {
  if (preview)
    return success(
      `Preview request ${id}\n${JSON.stringify(value, null, 2)}\nApply with: canvas apply ${id}`,
    );
  return dependencies.semantic.applied(value, id);
}
/** Agent authoring consumes readable source only. JSON envelopes and coordinates are never required user input. */
export async function author(
  command: Command,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const prepared = await prepare(command, dependencies);
  if (!prepared.ok) return prepared;
  return submit(prepared.value, command.name === 'preview', dependencies);
}
