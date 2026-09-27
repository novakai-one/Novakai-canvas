import { plannerId, proposalSchema, failure } from '@novakai/canvas-authoring';
import type {
  IntentPlanner,
  Request,
  Snapshot,
  Proposal,
  Result,
  ErrorCode,
} from '@novakai/canvas-authoring';
import { presetCommand } from '../../contract/records/presets/preparation.js';
import type {
  ResourceCommands,
  PresetPreparation,
  ResourceDiagnostic,
} from '../../contract/records/presets/preparation.js';
import { workspaceMetadata } from '../../contract/records/workspace/metadata.js';
const authoringCodes: Readonly<Record<string, ErrorCode>> = {
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
};
/** Preparation drift rejects without a write; retained requests recover through Authoring receipts. */
function plan(
  request: Request,
  snapshot: Snapshot,
  owner: Pick<ResourceCommands, 'preparePreset'>,
): Result<Proposal> {
  if (request.intent.kind !== 'change')
    return failure('invalid-input', 'preset', 'Expected a preset change');
  const command = presetCommand.safeParse(request.intent.payload);
  if (!command.success)
    return failure('invalid-input', 'preset', 'Expected an exact prepared preset');
  return reprepare(request, snapshot, owner, command.data);
}
/** Recompute only after decoding the exact prepared command. */
function reprepare(
  request: Request,
  snapshot: Snapshot,
  owner: Pick<ResourceCommands, 'preparePreset'>,
  command: ReturnType<typeof presetCommand.parse>,
): Result<Proposal> {
  const prepared = owner.preparePreset(
    { admission: command.admission, assets: request.assets },
    snapshot,
  );
  if (!prepared.ok) return authoringFailure(prepared.error);
  return compared(command, prepared.value, snapshot);
}
/** Pin and manifest comparison prevents caller substitution; read versions stay client-observed CAS preconditions. */
function compared(
  command: ReturnType<typeof presetCommand.parse>,
  prepared: PresetPreparation,
  snapshot: Snapshot,
): Result<Proposal> {
  const same =
    JSON.stringify([command.pin, command.key, command.resources]) ===
    JSON.stringify([prepared.pin, prepared.key, prepared.resources]);
  if (!same) return failure('revision-conflict', 'preset', 'Prepared preset content changed');
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
/** Every new identity changes shared metadata in the same proposal; competing inserts cannot both pass physical CAS. */
function insertion(
  prepared: PresetPreparation,
  snapshot: Snapshot,
): Result<Proposal> {
  const metadata = snapshot.records.find(
    (item) => item.key.kind === 'workspace' && item.key.id === 'metadata' && !item.deleted,
  );
  if (!metadata) return failure('corrupt-record', 'metadata', 'Workspace metadata is missing');
  const parsed = workspaceMetadata.safeParse(metadata.value);
  if (!parsed.success)
    return failure('corrupt-record', 'metadata', 'Workspace metadata is invalid');
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
/** Owner failures retain their path/message/recovery while Authoring admits only its bounded code vocabulary. */
function authoringFailure<T>(owner: ResourceDiagnostic): Result<T> {
  const code = authoringCodes[owner.code] ?? 'invalid-input';
  return {
    ok: false,
    error: { ...owner, code, targets: [], traceId: null },
  };
}

/** Schema limits reject as a typed planner outcome; no Zod exception crosses Authoring. */
function proposal(input: unknown): Result<Proposal> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success)
    return failure('invalid-input', 'preset.proposal', 'Prepared preset exceeds proposal limits');
  return { ok: true, value: parsed.data };
}
/** Only the named semantic planner is registered; Authoring supplies snapshot, scope and atomic write authority. */
export function createPresetPlanner(owner: Pick<ResourceCommands, 'preparePreset'>): IntentPlanner {
  return {
    id: plannerId.parse('preset'),
    plan: async (request, snapshot) => plan(request, snapshot, owner),
  };
}
