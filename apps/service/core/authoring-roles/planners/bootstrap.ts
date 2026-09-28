/*
 * Why this file exists
 *
 * A brand-new workspace is empty. Before anyone can use it, it needs its details record, an empty
 * catalog, and the built-in themes and recipes. For example, `pnpm dev --workspace ./new` on an
 * empty folder saves those records first.
 *
 * Those first records are saved through Authoring like any other change. This file builds that
 * change (`buildSeedRequest`) and the `bootstrap` planner that plans it; both answer Authoring's
 * `Result` (contract/errors.ts). Only start-up uses them; no HTTP route can reach the planner.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Preset,
  Proposal,
  Request,
} from '../../../contract/records/capability-types.js';
import type { NewWorkspaceSeed } from '../../../contract/records/workspace/startup.js';
import { initializeCommand } from '../../../contract/records/planning/commands.js';
import { actorId, plannerId, requestSchema } from '../../../contract/schemas.js';
import { andThen, authoringFailure, success } from '../../../contract/errors.js';
import { MAIN_CATALOG_ID, METADATA_RECORD_ID, presetRecordId } from '../../workspace/records.js';
import { presetResources } from '../../presets/resources.js';
import { readChangePayload, checkProposal } from './change-payload.js';

/** The actor that signs the installation request. Parsed once at module load; the ID is valid. */
const INSTALLATION_ACTOR: Request['actor'] = Object.freeze({
  id: actorId.parse('system:installation'),
  kind: 'human',
});

/**
 * Builds the `bootstrap` planner. Its `plan` answers a new workspace's first records from `seed`:
 * its details, an empty `main` catalog, and one record per built-in preset. Mistakes:
 * `invalid-input` at `bootstrap` when the request isn't the initialize change, or at
 * `bootstrap.proposal` when the seed is over Authoring's limits.
 */
export function createBootstrapPlanner(seed: NewWorkspaceSeed): IntentPlanner {
  return { id: plannerId.parse('bootstrap'), plan: async (request) => plan(request, seed) };
}

/**
 * Builds the change request that fills a new workspace with `seed`. It expects every record to be
 * absent, so it can never overwrite a workspace. Mistakes: `invalid-input` at `bootstrap.proposal`
 * when the seed is over Authoring's limits, or at `bootstrap` when the request fails its check.
 */
export function buildSeedRequest(seed: NewWorkspaceSeed): AuthoringResult<Request> {
  return andThen(proposal(seed), (planned) => requestFor(seed, planned));
}

/**
 * The installation request for the proposal's writes. Fails with `invalid-input` at `bootstrap`
 * when Authoring's request schema rejects it.
 */
function requestFor(
  installation: NewWorkspaceSeed,
  planned: Proposal,
): AuthoringResult<Request> {
  const writes = planned.writes;
  const parsed = requestSchema.safeParse({
    workspace: installation.workspace,
    request: 'initialize-workspace',
    version: 1,
    actor: INSTALLATION_ACTOR,
    assets: [],
    scope: writes.map((item) => item.key),
    expected: writes.map((item) => ({ key: item.key, version: 'absent' })),
    intent: { kind: 'change', planner: 'bootstrap', payload: { action: 'initialize' } },
  });
  if (!parsed.success)
    return authoringFailure(
      'invalid-input',
      'bootstrap',
      'NewWorkspaceSeed request could not be constructed',
    );
  return success(parsed.data);
}

/**
 * The `bootstrap` planner: answers the installation proposal (see `proposal`). Fails with
 * `invalid-input` at `bootstrap` when the request is not a change or its payload is not the
 * initialize command.
 */
function plan(
  request: Request,
  installation: NewWorkspaceSeed,
): AuthoringResult<Proposal> {
  const input = readChangePayload(request, 'bootstrap', 'Initialization requires a change request');
  if (!input.ok) return input;
  if (!initializeCommand.safeParse(input.value).success)
    return authoringFailure('invalid-input', 'bootstrap', 'Invalid initialization command');
  return proposal(installation);
}

/**
 * The installation proposal: workspace metadata, an empty `main` catalog and one write per
 * shipped preset, with no reads. Fails with `invalid-input` at `bootstrap.proposal` when the
 * installation exceeds Authoring's proposal limits.
 */
function proposal(installation: NewWorkspaceSeed): AuthoringResult<Proposal> {
  return checkProposal(
    {
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
    },
    'bootstrap.proposal',
    'NewWorkspaceSeed exceeds proposal limits',
  );
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
