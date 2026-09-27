/*
 * Authoring's `preset` planner role: repeats the preset preparation against Authoring's snapshot
 * and proposes the preset record plus the metadata revision bump. A drifted preparation rejects
 * without a write. Pure over the injected resource commands. Authoring owns commit and replay.
 */
import type {
  AuthoringErrorCode,
  AuthoringResult,
  IntentPlanner,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import { presetCommand } from '../../../contract/records/presets/preparation.js';
import type {
  ResourceCommands,
  PresetPreparation,
  ResourceDiagnostic,
} from '../../../contract/records/presets/preparation.js';
import { workspaceMetadata } from '../../../contract/records/workspace/metadata.js';
import { plannerId, proposalSchema } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/**
 * Binds the `preset` planner. `plan` fails with `invalid-input` at `preset` (not a change, or
 * not an exact prepared preset) or `preset.proposal` (over Authoring's limits),
 * `revision-conflict` at `preset` when the prepared content changed, `corrupt-record` at
 * `metadata` when workspace metadata is missing or invalid, and with the preparation's own
 * diagnostic when preparation fails (its code mapped to Authoring's, `invalid-input` otherwise).
 */
export function createPresetPlanner(owner: Pick<ResourceCommands, 'preparePreset'>): IntentPlanner {
  return {
    id: plannerId.parse('preset'),
    plan: async (request, snapshot) => plan(request, snapshot, owner),
  };
}

/**
 * The `preset` planner: decodes the prepared command, then repeats the preparation (see
 * `reprepare`). Fails with `invalid-input` at `preset` when the request is not a change or its
 * payload is not an exact prepared preset.
 */
function plan(
  request: Request,
  snapshot: Snapshot,
  owner: Pick<ResourceCommands, 'preparePreset'>,
): AuthoringResult<Proposal> {
  if (request.intent.kind !== 'change')
    return authoringFailure('invalid-input', 'preset', 'Expected a preset change');
  const command = presetCommand.safeParse(request.intent.payload);
  if (!command.success)
    return authoringFailure('invalid-input', 'preset', 'Expected an exact prepared preset');
  return reprepare(request, snapshot, owner, command.data);
}

/**
 * Repeats the preparation on Authoring's snapshot, then compares it with the command (see
 * `compared`). A failed preparation answers its own diagnostic (see `ownerRejected`).
 */
function reprepare(
  request: Request,
  snapshot: Snapshot,
  owner: Pick<ResourceCommands, 'preparePreset'>,
  command: ReturnType<typeof presetCommand.parse>,
): AuthoringResult<Proposal> {
  const prepared = owner.preparePreset(
    { admission: command.admission, assets: request.assets },
    snapshot,
  );
  if (!prepared.ok) return ownerRejected(prepared.error);
  return compared(command, prepared.value, snapshot);
}

/**
 * The preparation's diagnostic as an Authoring failure. Path, message, recovery and source are
 * kept. The code is kept when Authoring has it too, otherwise it becomes `invalid-input`.
 */
function ownerRejected<T>(owner: ResourceDiagnostic): AuthoringResult<T> {
  const code = authoringCodes[owner.code] ?? 'invalid-input';
  return {
    ok: false,
    error: { ...owner, code, targets: [], traceId: null },
  };
}

/** The preparation codes Authoring has too, each mapped to itself. */
const authoringCodes: Readonly<Record<string, AuthoringErrorCode>> = Object.freeze({
  'invalid-input': 'invalid-input',
  'unsupported-version': 'unsupported-version',
  'unknown-reference': 'unknown-reference',
  'invariant-violation': 'invariant-violation',
  'constraint-conflict': 'constraint-conflict',
  'revision-conflict': 'revision-conflict',
  'request-reused': 'request-reused',
  'missing-asset': 'missing-asset',
  'permission-denied': 'permission-denied',
  'storage-unavailable': 'storage-unavailable',
  'corrupt-record': 'corrupt-record',
  cancelled: 'cancelled',
});

/**
 * Answers a proposal with no writes when the preset is already stored, otherwise the insertion
 * (see `insertion`). Fails with `revision-conflict` at `preset` when the prepared pin, key or
 * resources differ from the command's, and `invalid-input` at `preset.proposal` when the proposal
 * exceeds Authoring's limits.
 */
function compared(
  command: ReturnType<typeof presetCommand.parse>,
  prepared: PresetPreparation,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  const same =
    JSON.stringify([command.pin, command.key, command.resources]) ===
    JSON.stringify([prepared.pin, prepared.key, prepared.resources]);
  if (!same)
    return authoringFailure('revision-conflict', 'preset', 'Prepared preset content changed');
  const existing = snapshot.records.find(
    (item) => item.key.kind === 'preset' && item.key.id === prepared.key.id && !item.deleted,
  );
  if (existing)
    return proposal({
      reads: prepared.reads,
      writes: [],
      diff: { preset: prepared.pin },
      warnings: [],
    });
  return insertion(prepared, snapshot);
}

/**
 * Proposes the preset record and the workspace metadata with `presetRevision` raised by one, so
 * two inserts from the same snapshot cannot both commit. Fails with `corrupt-record` at
 * `metadata` when workspace metadata is missing or invalid, and `invalid-input` at
 * `preset.proposal` when the proposal exceeds Authoring's limits.
 */
function insertion(
  prepared: PresetPreparation,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  const metadata = snapshot.records.find(
    (item) => item.key.kind === 'workspace' && item.key.id === 'metadata' && !item.deleted,
  );
  if (!metadata)
    return authoringFailure('corrupt-record', 'metadata', 'Workspace metadata is missing');
  const parsed = workspaceMetadata.safeParse(metadata.value);
  if (!parsed.success)
    return authoringFailure('corrupt-record', 'metadata', 'Workspace metadata is invalid');
  return proposal({
    reads: prepared.reads,
    writes: [
      { kind: 'put', key: prepared.key, value: prepared.record, resources: prepared.resources },
      {
        kind: 'put',
        key: metadata.key,
        value: { ...parsed.data, presetRevision: parsed.data.presetRevision + 1 },
        resources: [],
      },
    ],
    diff: { preset: prepared.pin },
    warnings: [],
  });
}

/**
 * Checks the proposal against Authoring's schema. Fails with `invalid-input` at
 * `preset.proposal` when it exceeds Authoring's limits.
 */
function proposal(input: unknown): AuthoringResult<Proposal> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success)
    return authoringFailure(
      'invalid-input',
      'preset.proposal',
      'Prepared preset exceeds proposal limits',
    );
  return { ok: true, value: parsed.data };
}
