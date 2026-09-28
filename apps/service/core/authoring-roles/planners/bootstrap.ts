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
} from '../../../contract/records/capability-types.js';
import type { NewWorkspaceSeed } from '../../../contract/records/workspace/startup.js';
import { initializeCommand } from '../../../contract/records/planning/commands.js';
import { actorId, plannerId, requestSchema } from '../../../contract/schemas.js';
import { andThen, authoringFailure, success } from '../../../contract/errors.js';
import { MAIN_CATALOG_ID, METADATA_RECORD_ID, presetRecordId } from '../../workspace/records.js';
import { presetResources } from '../../presets/resources.js';
import { changePayload, checkedProposal } from './change-payload.js';

/** The actor that signs the installation request. Parsed once at module load; the ID is valid. */
const INSTALLATION_ACTOR: Request['actor'] = Object.freeze({
  id: actorId.parse('system:installation'),
  kind: 'human',
});

/**
 * Binds the private `bootstrap` planner to trusted installation data; HTTP never exposes it.
 * `plan` answers the installation proposal, or `invalid-input` at `bootstrap` when the request
 * is not a change or its payload is not the initialize command, and `invalid-input` at
 * `bootstrap.proposal` when the trusted installation breaks Authoring's proposal limits.
 */
export function createInstallationPlanner(installation: NewWorkspaceSeed): IntentPlanner {
  return { id: plannerId.parse('bootstrap'), plan: async (request) => plan(request, installation) };
}

/**
 * The deterministic installation request: it expects every installation record to be absent,
 * so it never replaces or upserts an existing workspace. Fails with `invalid-input` at
 * `bootstrap.proposal` when the installation breaks Authoring's proposal limits, and
 * `invalid-input` at `bootstrap` when Authoring's request schema rejects the request.
 */
export function installationRequest(installation: NewWorkspaceSeed): AuthoringResult<Request> {
  return andThen(proposal(installation), (planned) => requestFor(installation, planned));
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
  const input = changePayload(request, 'bootstrap', 'Initialization requires a change request');
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
  return checkedProposal(
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
