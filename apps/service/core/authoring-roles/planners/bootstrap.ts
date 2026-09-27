import { z } from 'zod';
import { plannerId, proposalSchema, requestSchema, failure } from '@novakai/canvas-authoring';
import type { IntentPlanner, Proposal, Result, Request } from '@novakai/canvas-authoring';
import type { Preset } from '@novakai/canvas-templates';
import type { Installation } from '../../../contract/records/workspace/installation.js';
const initialize = z.strictObject({ action: z.literal('initialize') });
/** Templates already admitted this exact immutable preset; Authoring still validates the complete candidate and byte coverage. */
function presetWrite(preset: Preset): unknown {
  return {
    kind: 'put',
    key: { kind: 'preset', id: `preset:${preset.digest}` },
    value: preset,
    resources: preset.kind === 'theme' ? preset.payload.fonts : preset.payload.assets,
  };
}
/** Startup proposes ordinary canonical records and receives the same atomic receipt/history semantics as other authors. */
function proposal(installation: Installation): Proposal {
  return proposalSchema.parse({
    reads: [],
    diff: { initialized: installation.workspace },
    warnings: [],
    writes: [
      {
        kind: 'put',
        key: { kind: 'workspace', id: 'metadata' },
        value: {
          schemaVersion: 1,
          id: installation.workspace,
          title: installation.title,
          createdAt: installation.createdAt,
        },
        resources: [],
      },
      {
        kind: 'put',
        key: { kind: 'catalog', id: 'main' },
        value: { schemaVersion: 1, id: 'main', revision: 0, folders: [], entries: [] },
        resources: [],
      },
      ...installation.presets.map(presetWrite),
    ],
  });
}
/** Private startup envelope cannot substitute arbitrary preset/workspace JSON; HTTP never exposes this planner. */
function plan(
  request: Request,
  installation: Installation,
): Result<Proposal> {
  if (request.intent.kind !== 'change')
    return failure('invalid-input', 'bootstrap', 'Initialization requires a change request');
  if (!initialize.safeParse(request.intent.payload).success)
    return failure('invalid-input', 'bootstrap', 'Invalid initialization command');
  return { ok: true, value: proposal(installation) };
}
/** Bind trusted installation data once; callers invoke the ordinary Authoring API and own retry via its persisted receipt. */
export function createInstallationPlanner(installation: Installation): IntentPlanner {
  return { id: plannerId.parse('bootstrap'), plan: async (request) => plan(request, installation) };
}
/** Deterministic installation request needs complete absence, never an implicit replace or upsert of an existing workspace. */
export function installationRequest(installation: Installation): Result<Request> {
  const writes = proposal(installation).writes;
  const result = requestSchema.safeParse({
    workspace: installation.workspace,
    request: 'initialize-workspace',
    version: 1,
    actor: { id: 'system:installation', kind: 'human' },
    assets: [],
    scope: writes.map((item) => item.key),
    expected: writes.map((item) => ({ key: item.key, version: 'absent' })),
    intent: { kind: 'change', planner: 'bootstrap', payload: { action: 'initialize' } },
  });
  if (!result.success)
    return failure('invalid-input', 'bootstrap', 'Installation request could not be constructed');
  return { ok: true, value: result.data };
}
