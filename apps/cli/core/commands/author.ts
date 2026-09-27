import { prepareResources, restoreResources } from './resources.js';
import type { Command } from '../../contract/records/command.js';
import type { CliDependencies, RequestDraft } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';

/** Capture source and observed versions once; neither preview nor apply refreshes the resulting Authoring envelope. */
async function prepare(
  command: Command,
  dependencies: CliDependencies,
): Promise<Result<RequestDraft>> {
  const source = await dependencies.files.source(command.target);
  if (!source.ok) return source;
  const current = await dependencies.transport.get('/api/v1/workspace');
  if (!current.ok) return current;
  return prepareCaptured(command, source.value, current.value, dependencies);
}
/** Capture and resource preparation finish before retention or canonical submission. */
async function prepareCaptured(
  command: Command,
  source: string,
  current: import('../../contract/records/owners.js').TransportResponse,
  dependencies: CliDependencies,
): Promise<Result<RequestDraft>> {
  const draft = captured(command, source, current, dependencies);
  if (!draft.ok) return draft;
  return prepareResources(command, source, draft.value, dependencies);
}
/** Owner readers give transported snapshots their type before request construction. */
function captured(
  command: Command,
  source: string,
  current: import('../../contract/records/owners.js').TransportResponse,
  dependencies: CliDependencies,
): Result<RequestDraft> {
  if (!current.outcome.ok) return current.outcome;
  const snapshot = dependencies.semantic.snapshot(current.outcome.value);
  if (!snapshot.ok) return snapshot;
  return draft(command, source, snapshot.value, current.generation, dependencies);
}
/** An explicit ID supports scripted receipt lookup; generated IDs are persisted before any network submission. */
function draft(
  command: Command,
  source: string,
  snapshot: import('../../contract/records/owners.js').Snapshot,
  generation: string,
  dependencies: CliDependencies,
): Result<RequestDraft> {
  const request = dependencies.semantic.request(
    command,
    source,
    snapshot,
    command.request ?? dependencies.nextRequestId(),
  );
  if (!request.ok) return request;
  return { ok: true, value: { generation, request: request.value } };
}
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
  result: Result<import('../../contract/records/owners.js').TransportResponse>,
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
  if (!result.value.outcome.ok) return result.value.outcome;
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
    return {
      ok: true,
      value: `Preview request ${id}\n${JSON.stringify(value, null, 2)}\nApply with: canvas apply ${id}`,
    };
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
  response: import('../../contract/records/owners.js').TransportResponse,
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
