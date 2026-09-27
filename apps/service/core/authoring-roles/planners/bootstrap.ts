/*
 * Authoring's bootstrap planner role and the deterministic installation request that uses it.
 * A new workspace receives its metadata, empty catalog and shipped presets as ordinary canonical
 * writes. Pure over the trusted installation data. Authoring owns commit, receipt and retry.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Preset,
  Proposal,
  Request,
} from '../../../contract/records/capabilities.js';
import type { Installation } from '../../../contract/records/workspace/installation.js';
import { initializeCommand } from '../../../contract/records/planning/commands.js';
import { plannerId, proposalSchema, requestSchema } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/**
 * Binds the private `bootstrap` planner to trusted installation data; HTTP never exposes it.
 * `plan` answers the installation proposal, or `invalid-input` at `bootstrap` when the request
 * is not a change or its payload is not the initialize command.
 */
export function createInstallationPlanner(installation: Installation): IntentPlanner {
  return { id: plannerId.parse('bootstrap'), plan: async (request) => plan(request, installation) };
}
/**
 * The deterministic installation request: it expects every installation record to be absent,
 * so it never replaces or upserts an existing workspace. Fails with `invalid-input` at
 * `bootstrap` when Authoring's request schema rejects it.
 */
export function installationRequest(installation: Installation): AuthoringResult<Request> {
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
    return authoringFailure(
      'invalid-input',
      'bootstrap',
      'Installation request could not be constructed',
    );
  return { ok: true, value: result.data };
}
/** Private startup envelope cannot substitute arbitrary preset/workspace JSON; HTTP never exposes this planner. */
function plan(
  request: Request,
  installation: Installation,
): AuthoringResult<Proposal> {
  if (request.intent.kind !== 'change')
    return authoringFailure(
      'invalid-input',
      'bootstrap',
      'Initialization requires a change request',
    );
  if (!initializeCommand.safeParse(request.intent.payload).success)
    return authoringFailure('invalid-input', 'bootstrap', 'Invalid initialization command');
  return { ok: true, value: proposal(installation) };
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
/** Templates already admitted this exact immutable preset; Authoring still validates the complete candidate and byte coverage. */
function presetWrite(preset: Preset): unknown {
  return {
    kind: 'put',
    key: { kind: 'preset', id: `preset:${preset.digest}` },
    value: preset,
    resources: preset.kind === 'theme' ? preset.payload.fonts : preset.payload.assets,
  };
}
