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
import { MAIN_CATALOG_ID, METADATA_RECORD_ID, presetRecordId } from '../../workspace/records.js';
import { presetResources } from '../../presets/resources.js';
import { changePayload } from './change-payload.js';

/**
 * Binds the private `bootstrap` planner to trusted installation data; HTTP never exposes it.
 * `plan` answers the installation proposal, or `invalid-input` at `bootstrap` when the request
 * is not a change or its payload is not the initialize command. Building the proposal throws
 * only when the trusted installation breaks Authoring's proposal limits; Authoring's planner
 * boundary turns that into a failure.
 */
export function createInstallationPlanner(installation: Installation): IntentPlanner {
  return { id: plannerId.parse('bootstrap'), plan: async (request) => plan(request, installation) };
}

/**
 * The deterministic installation request: it expects every installation record to be absent,
 * so it never replaces or upserts an existing workspace. Fails with `invalid-input` at
 * `bootstrap` when Authoring's request schema rejects it. The same proposal throw as `plan` is
 * caught by compose startup, which answers `unavailable` and keeps the workspace files.
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

/**
 * The `bootstrap` planner: answers the installation proposal (see `proposal`, which can throw).
 * Fails with `invalid-input` at `bootstrap` when the request is not a change or its payload is
 * not the initialize command.
 */
function plan(
  request: Request,
  installation: Installation,
): AuthoringResult<Proposal> {
  const input = changePayload(request, 'bootstrap', 'Initialization requires a change request');
  if (!input.ok) return input;
  if (!initializeCommand.safeParse(input.value).success)
    return authoringFailure('invalid-input', 'bootstrap', 'Invalid initialization command');
  return { ok: true, value: proposal(installation) };
}

/**
 * The installation proposal: workspace metadata, an empty `main` catalog and one write per
 * shipped preset, with no reads. Returns no failure code: it throws a schema error when the
 * installation exceeds Authoring's proposal limits.
 */
function proposal(installation: Installation): Proposal {
  return proposalSchema.parse({
    reads: [],
    diff: { initialized: installation.workspace },
    warnings: [],
    writes: [
      {
        kind: 'put',
        key: { kind: 'workspace', id: METADATA_RECORD_ID },
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
        key: { kind: 'catalog', id: MAIN_CATALOG_ID },
        value: { schemaVersion: 1, id: MAIN_CATALOG_ID, revision: 0, folders: [], entries: [] },
        resources: [],
      },
      ...installation.presets.map(presetWrite),
    ],
  });
}

/**
 * One preset's write at `preset:<digest>`, retaining a theme's fonts or a recipe's assets.
 * Never fails.
 */
function presetWrite(preset: Preset): unknown {
  return {
    kind: 'put',
    key: { kind: 'preset', id: presetRecordId(preset.digest) },
    value: preset,
    resources: presetResources(preset),
  };
}
