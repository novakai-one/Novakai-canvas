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
  Json,
  Preset,
  Proposal,
  Request,
} from '../../../contract/records/capability-types.js';
import type { NewWorkspaceSeed } from '../../../contract/records/workspace/startup.js';
import { initializeCommand } from '../../../contract/records/planning/commands.js';
import { actorId, plannerId, requestSchema } from '../../../contract/schemas.js';
import { authoringFailure, success } from '../../../contract/errors.js';
import { MAIN_CATALOG_ID, METADATA_RECORD_ID, presetRecordId } from '../../workspace/records.js';
import { listPresetFileDigests } from '../../presets/resources.js';
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
  return {
    id: plannerId.parse('bootstrap'),
    plan: async (request) => planBootstrap(request, seed),
  };
}

/**
 * Builds the change request that fills a new workspace with `seed`. It expects every record to be
 * absent, so it can never overwrite a workspace. Mistakes: `invalid-input` at `bootstrap.proposal`
 * when the seed is over Authoring's limits, or at `bootstrap` when the request fails its check.
 */
export function buildSeedRequest(seed: NewWorkspaceSeed): AuthoringResult<Request> {
  const seedProposal = proposeSeedRecords(seed);
  if (!seedProposal.ok) {
    return seedProposal;
  }
  return buildInstallationRequest(seed, seedProposal.value);
}

/** One of the seed's planned writes, after Authoring's proposal check. */
type SeedWrite = Proposal['writes'][number];

/** Checks the request is the initialize change, then plans the seed's first records. */
function planBootstrap(
  request: Request,
  seed: NewWorkspaceSeed,
): AuthoringResult<Proposal> {
  const payload = readChangePayload(
    request,
    'bootstrap',
    'Initialization requires a change request',
  );
  if (!payload.ok) {
    return payload;
  }
  if (!isInitializeCommand(payload.value)) {
    return notInitializeFailure();
  }
  return proposeSeedRecords(seed);
}

/** Whether the change's payload is the private `initialize` command. */
function isInitializeCommand(payload: Json): boolean {
  const command = initializeCommand.safeParse(payload);
  return command.success;
}

/** Builds the installation request that saves the seed's writes, each expected to be absent. */
function buildInstallationRequest(
  seed: NewWorkspaceSeed,
  seedProposal: Proposal,
): AuthoringResult<Request> {
  const envelope = installationEnvelope(seed, seedProposal.writes);
  const request = requestSchema.safeParse(envelope);
  if (!request.success) {
    return unbuildableRequestFailure();
  }
  return success(request.data);
}

/** Lays out the installation request before Authoring's request check reads it. */
function installationEnvelope(
  seed: NewWorkspaceSeed,
  writes: readonly SeedWrite[],
): unknown {
  return {
    workspace: seed.workspace,
    request: 'initialize-workspace',
    version: 1,
    actor: INSTALLATION_ACTOR,
    assets: [],
    scope: writes.map((write) => write.key),
    expected: writes.map((write) => ({ key: write.key, version: 'absent' })),
    intent: { kind: 'change', planner: 'bootstrap', payload: { action: 'initialize' } },
  };
}

/** Plans the seed's first records: its details, an empty `main` catalog, and each preset. */
function proposeSeedRecords(seed: NewWorkspaceSeed): AuthoringResult<Proposal> {
  const writes = [metadataWrite(seed), emptyCatalogWrite(), ...seed.presets.map(presetWrite)];
  const planned = { reads: [], diff: { initialized: seed.workspace }, warnings: [], writes };
  return checkProposal(planned, 'bootstrap.proposal', 'NewWorkspaceSeed exceeds proposal limits');
}

/** Plans the write of the workspace's details record. */
function metadataWrite(seed: NewWorkspaceSeed): unknown {
  const details = {
    schemaVersion: 1,
    id: seed.workspace,
    title: seed.title,
    createdAt: seed.createdAt,
  };
  return {
    kind: 'put',
    key: { kind: 'workspace', id: METADATA_RECORD_ID },
    value: details,
    resources: [],
  };
}

/** Plans the write of the empty `main` catalog. */
function emptyCatalogWrite(): unknown {
  const emptyCatalog = {
    schemaVersion: 1,
    id: MAIN_CATALOG_ID,
    revision: 0,
    folders: [],
    entries: [],
  };
  return {
    kind: 'put',
    key: { kind: 'catalog', id: MAIN_CATALOG_ID },
    value: emptyCatalog,
    resources: [],
  };
}

/** Plans one preset's write at `preset:<digest>`, keeping a theme's fonts or a recipe's files. */
function presetWrite(preset: Preset): unknown {
  return {
    kind: 'put',
    key: { kind: 'preset', id: presetRecordId(preset.digest) },
    value: preset,
    resources: listPresetFileDigests(preset),
  };
}

/** Makes the mistake for a change that isn't the `initialize` command. */
function notInitializeFailure(): AuthoringResult<never> {
  return authoringFailure('invalid-input', 'bootstrap', 'Invalid initialization command');
}

/** Makes the mistake for a seed request that fails Authoring's request check. */
function unbuildableRequestFailure(): AuthoringResult<never> {
  return authoringFailure(
    'invalid-input',
    'bootstrap',
    'NewWorkspaceSeed request could not be constructed',
  );
}
