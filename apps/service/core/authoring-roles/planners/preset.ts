/*
 * Why this file exists
 *
 * Saving a theme or recipe takes two steps. For example, `pnpm canvas theme admit blueprint.theme`
 * first prepares the theme, then sends the prepared result as a `preset` change. The workspace
 * might change in between, so the prepared result can't just be trusted.
 *
 * This file is the `preset` planner. It prepares the preset again on Authoring's snapshot and
 * refuses the change if the result differs. Otherwise it plans the preset's write, or no write if
 * it is already stored. It only plans; Authoring saves.
 */
import type {
  AuthoringErrorCode,
  AuthoringResult,
  IntentPlanner,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import { presetCommand } from '../../../contract/records/presets/preparation.js';
import type {
  PresetCommand,
  PresetPreparation,
} from '../../../contract/records/presets/preparation.js';
import type {
  ResourceDiagnostic,
  ResourceErrorCode,
} from '../../../contract/records/presets/resource-commands.js';
import type { ResourceCommands } from '../../../contract/ports/workspace.js';
import { workspaceMetadata } from '../../../contract/records/workspace/metadata.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure, success } from '../../../contract/errors.js';
import { findLiveRecord, METADATA_RECORD_ID } from '../../workspace/records.js';
import { readChangePayload, checkProposal } from './change-payload.js';

/**
 * Builds the `preset` planner. Its `plan` prepares the preset again with `preparePreset` and
 * answers the planned save. Mistakes: `revision-conflict` at `preset` when the prepared content
 * changed, `corrupt-record` at `metadata` when the workspace's details are missing or broken,
 * `invalid-input` for a malformed change, or the preparation's own mistake.
 */
export function createPresetPlanner(
  resourceCommands: Pick<ResourceCommands, 'preparePreset'>,
): IntentPlanner {
  return {
    id: plannerId.parse('preset'),
    plan: async (request, snapshot) => planPresetChange(request, snapshot, resourceCommands),
  };
}

/** The fields of a record key the comparison reads. */
interface KeyFields {
  readonly kind: string;
  readonly id: string;
}

/** The fields of a preset pin the comparison reads. */
interface PinFields {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/**
 * The Authoring code of each preparation code: Authoring's own codes map to themselves; the codes
 * only Templates has become `invalid-input` (the caller corrects the preset and prepares again).
 */
const AUTHORING_CODE: Readonly<Record<ResourceErrorCode, AuthoringErrorCode>> = Object.freeze({
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
  'missing-preset': 'invalid-input',
  'digest-mismatch': 'invalid-input',
  'version-exists': 'invalid-input',
  'duplicate-preset': 'invalid-input',
  'dependency-cycle': 'invalid-input',
  'provider-failed': 'invalid-input',
});

/** Reads the prepared preset, prepares it again to check it still holds, then plans its save. */
function planPresetChange(
  request: Request,
  snapshot: Snapshot,
  resourceCommands: Pick<ResourceCommands, 'preparePreset'>,
): AuthoringResult<Proposal> {
  const command = readPresetCommand(request);
  if (!command.ok) {
    return command;
  }
  const prepared = prepareAgain(request, snapshot, command.value, resourceCommands);
  if (!prepared.ok) {
    return prepared;
  }
  return proposePresetSave(prepared.value, snapshot);
}

/** Takes the prepared preset command out of the request. */
function readPresetCommand(request: Request): AuthoringResult<PresetCommand> {
  const payload = readChangePayload(request, 'preset', 'Expected a preset change');
  if (!payload.ok) {
    return payload;
  }
  const command = presetCommand.safeParse(payload.value);
  if (!command.success) {
    return malformedPresetCommandFailure();
  }
  return success(command.data);
}

/** Prepares the preset again on Authoring's snapshot, and checks it came out the same. */
function prepareAgain(
  request: Request,
  snapshot: Snapshot,
  command: PresetCommand,
  resourceCommands: Pick<ResourceCommands, 'preparePreset'>,
): AuthoringResult<PresetPreparation> {
  const preparationInput = { admission: command.admission, assets: request.assets };
  const prepared = resourceCommands.preparePreset(preparationInput, snapshot);
  if (!prepared.ok) {
    return preparationFailure(prepared.error);
  }
  if (!sameContent(command, prepared.value)) {
    return changedPresetFailure();
  }
  return success(prepared.value);
}

/** Plans no write when the preset is already stored, and its insertion when it is new. */
function proposePresetSave(
  prepared: PresetPreparation,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  if (isPresetStored(prepared, snapshot)) {
    return proposeNoWrites(prepared);
  }
  return proposeInsertion(prepared, snapshot);
}

/** Whether a live record already holds this preset. */
function isPresetStored(
  prepared: PresetPreparation,
  snapshot: Snapshot,
): boolean {
  const stored = findLiveRecord(snapshot, 'preset', prepared.key.id);
  return stored !== undefined;
}

/** Plans an empty save for a preset that is already stored; the reads still guard it. */
function proposeNoWrites(prepared: PresetPreparation): AuthoringResult<Proposal> {
  const planned = {
    reads: prepared.reads,
    writes: [],
    diff: { preset: prepared.pin },
    warnings: [],
  };
  return checkPresetProposal(planned);
}

/**
 * Plans the preset's record and the workspace's details with `presetRevision` raised by one, so
 * two saves from the same snapshot cannot both succeed.
 */
function proposeInsertion(
  prepared: PresetPreparation,
  snapshot: Snapshot,
): AuthoringResult<Proposal> {
  const metadataWrite = raisePresetRevision(snapshot);
  if (!metadataWrite.ok) {
    return metadataWrite;
  }
  const presetWrite = {
    kind: 'put',
    key: prepared.key,
    value: prepared.record,
    resources: prepared.resources,
  };
  const planned = {
    reads: prepared.reads,
    writes: [presetWrite, metadataWrite.value],
    diff: { preset: prepared.pin },
    warnings: [],
  };
  return checkPresetProposal(planned);
}

/** Plans the write of the workspace's details with `presetRevision` raised by one. */
function raisePresetRevision(snapshot: Snapshot): AuthoringResult<unknown> {
  const record = findLiveRecord(snapshot, 'workspace', METADATA_RECORD_ID);
  if (record === undefined) {
    return missingMetadataFailure();
  }
  const metadata = workspaceMetadata.safeParse(record.value);
  if (!metadata.success) {
    return invalidMetadataFailure();
  }
  const presetRevision = metadata.data.presetRevision + 1;
  const raised = { ...metadata.data, presetRevision };
  const metadataWrite = { kind: 'put', key: record.key, value: raised, resources: [] };
  return success(metadataWrite);
}

/** Checks the planned save fits Authoring's limits. */
function checkPresetProposal(planned: unknown): AuthoringResult<Proposal> {
  return checkProposal(planned, 'preset.proposal', 'Prepared preset exceeds proposal limits');
}

/** Whether the second preparation has the command's pin, record key and files, in the same order. */
function sameContent(
  command: PresetCommand,
  prepared: PresetPreparation,
): boolean {
  return (
    samePin(command.pin, prepared.pin) &&
    sameRecordKey(command.key, prepared.key) &&
    sameDigests(command.resources, prepared.resources)
  );
}

/** Whether two record keys have the same kind and ID. */
function sameRecordKey(
  left: KeyFields,
  right: KeyFields,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** Whether two pins have the same kind, ID, version and digest. */
function samePin(
  left: PinFields,
  right: PinFields,
): boolean {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

/** Whether two digest lists hold the same digests in the same order. */
function sameDigests(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((digest, index) => digest === right[index]);
}

/** Makes the mistake for a preset change that isn't an exact prepared preset. */
function malformedPresetCommandFailure(): AuthoringResult<never> {
  return authoringFailure('invalid-input', 'preset', 'Expected an exact prepared preset');
}

/**
 * Makes the preparation's own mistake into Authoring's, keeping its path, message, recovery and
 * source; the code is looked up in `AUTHORING_CODE`.
 */
function preparationFailure(preparationMistake: ResourceDiagnostic): AuthoringResult<never> {
  const code = AUTHORING_CODE[preparationMistake.code];
  return {
    ok: false,
    error: { ...preparationMistake, code, targets: [], traceId: null },
  };
}

/** Makes the mistake for a preset whose second preparation came out different. */
function changedPresetFailure(): AuthoringResult<never> {
  return authoringFailure('revision-conflict', 'preset', 'Prepared preset content changed');
}

/** Makes the mistake for a workspace whose details record is missing. */
function missingMetadataFailure(): AuthoringResult<never> {
  return authoringFailure('corrupt-record', 'metadata', 'Workspace metadata is missing');
}

/** Makes the mistake for a workspace whose details record is broken. */
function invalidMetadataFailure(): AuthoringResult<never> {
  return authoringFailure('corrupt-record', 'metadata', 'Workspace metadata is invalid');
}
