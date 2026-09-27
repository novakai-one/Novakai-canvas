/*
 * Authoring's candidate validator role: the mandatory final gate over a stamped candidate. Every
 * collection, preset, metadata and asset-admission record is checked against its owner and its
 * retained bytes. Pure over the injected owners; private typed throws stop at `validate`.
 * Authoring keeps the committed snapshot on rejection and owns scope, commit and recovery.
 */
import type {
  Assets,
  AuthoringResult,
  CandidateValidator,
  Preset,
  ReadVersion,
  Snapshot,
  StoredRecord,
} from '../../../contract/records/capabilities.js';
import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import type { ResourceSelector } from '../../../contract/records/planning/planning.js';
import type {
  WorkspaceContents,
  WorkspaceReader,
} from '../../../contract/records/workspace/contents.js';
import { workspaceMetadata, assetMetadata } from '../../../contract/records/workspace/metadata.js';
import { authoringFailure } from '../../../contract/errors.js';

/** What candidate validation reads; no validator can commit or alter the candidate it inspects. */
export interface CandidateValidatorOwners {
  readonly workspace: WorkspaceReader;
  readonly resources: ResourceSelector;
  readonly assets: Pick<Assets, 'resolve'>;
}

/**
 * Binds the validator. `validate` answers the read versions it consulted (history excluded), or:
 * - `invariant-violation` at `candidate` when a record is missing, a revision or retained byte
 *   manifest differs, metadata is invalid or names another workspace, or bytes are missing
 *   (the owner's failure kept as source where there is one);
 * - `corrupt-record` at `candidate` on any unexpected fault.
 * Reader failures pass through unchanged.
 */
export function createCandidateValidator(owners: CandidateValidatorOwners): CandidateValidator {
  return {
    async validate(before, after): Promise<AuthoringResult<readonly ReadVersion[]>> {
      try {
        return checked(before, after, owners);
      } catch (error) {
        return rejected(error);
      }
    },
  };
}
/** Cross-owner references are validated as a whole; a missing participant never becomes a skipped check. */
class AdmissionFault extends Error {
  /** Expected owner failures keep their evidence through private short-circuiting. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}
/** Failure is raised only inside the named candidate boundary; Authoring retains the original committed snapshot. */
function requireFact(
  condition: boolean,
  message: string,
): void {
  if (!condition) throw new AdmissionFault(message);
}
/** Every authoritative entity must occupy its expected composite storage identity and exact stamped version. */
function record(
  snapshot: Snapshot,
  kind: StoredRecord['key']['kind'],
  id: string,
): StoredRecord {
  const value = snapshot.records.find(
    (item) => !item.deleted && item.key.kind === kind && item.key.id === id,
  );
  if (!value) throw new AdmissionFault(`Missing canonical record ${kind}:${id}`);
  return value;
}
/** Resources are actual blob hashes; immutable preset provenance remains in canonical preset records, not fake blob storage. */
function resources(
  record: StoredRecord,
  expected: readonly string[],
): void {
  requireFact(
    JSON.stringify([...record.resources].toSorted()) ===
      JSON.stringify([...new Set(expected)].toSorted()),
    `Resource retention differs for ${record.key.kind}:${record.key.id}`,
  );
}
/** Every diagram pin/media binding is checked through its owners before comparing its retained byte manifest. */
function collections(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): void {
  view.collections.forEach((collection) => {
    const slot = record(snapshot, 'collection', collection.id);
    requireFact(
      slot.version === collection.revision,
      `Collection revision differs: ${collection.id}`,
    );
    const expected = owners.resources.forCollection(collection, view);
    if (!expected.ok) throw new AdmissionFault(expected.error.message, expected.error);
    resources(slot, expected.value);
  });
}
/** Theme tokens retain their exact fonts; recipes retain their direct media while referenced immutable themes retain their own fonts. */
function presetResources(preset: Preset): readonly string[] {
  if (preset.kind === 'theme') return preset.payload.fonts;
  return preset.payload.assets;
}
/** Preset hashes/dependency closure have already passed Templates; the bridge checks their physical byte retention. */
function presets(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): void {
  view.presets.forEach((preset) => {
    const slot = record(snapshot, 'preset', `preset:${preset.digest}`);
    const expected = presetResources(preset);
    resources(slot, expected);
    expected.forEach((digest) =>
      requireFact(owners.assets.resolve(digest).ok, `Missing preset bytes ${digest}`),
    );
  });
}
/** Discovery metadata does not mint a blob; a corresponding mechanically admitted resource must already exist. */
function asset(
  record: StoredRecord,
  owners: CandidateValidatorOwners,
): void {
  const parsed = assetMetadata.safeParse(record.value);
  if (!parsed.success) throw new AdmissionFault('Invalid asset discovery metadata');
  requireFact(
    record.key.id === `asset:${parsed.data.digest}`,
    'Asset discovery identity differs from its digest',
  );
  resources(record, [parsed.data.digest]);
  requireFact(
    owners.assets.resolve(parsed.data.digest).ok,
    `Missing admitted asset ${parsed.data.digest}`,
  );
}
/** Workspace identity cannot switch through an ordinary mutation; verified restore owns that host lifecycle. */
function metadata(
  snapshot: Snapshot,
  view: WorkspaceContents,
  owners: CandidateValidatorOwners,
): void {
  const slot = record(snapshot, 'workspace', 'metadata');
  const parsed = workspaceMetadata.safeParse(slot.value);
  if (!parsed.success) throw new AdmissionFault('Invalid workspace metadata');
  requireFact(parsed.data.id === snapshot.workspace, 'Workspace metadata identity differs');
  resources(slot, []);
  const catalog = record(snapshot, 'catalog', view.library.organisation.id);
  requireFact(catalog.version === view.library.organisation.revision, 'Catalog revision differs');
  resources(catalog, []);
  snapshot.records
    .filter((item) => !item.deleted && item.key.kind === 'asset-admission')
    .forEach((item) => asset(item, owners));
}
/** Validate the exact stamped candidate and return the source versions actually consulted, excluding engine-owned history. */
function checked(
  before: Snapshot,
  after: Snapshot,
  owners: CandidateValidatorOwners,
): AuthoringResult<readonly ReadVersion[]> {
  const view = owners.workspace.read(after);
  if (!view.ok) return view;
  collections(after, view.value, owners);
  presets(after, view.value, owners);
  metadata(after, view.value, owners);
  return {
    ok: true,
    value: before.records
      .filter((item) => item.key.kind !== 'history')
      .map((item) => ({ key: item.key, version: item.version })),
  };
}
/** Structured consistency faults are actionable; unexpected provider errors never authorize partial admission. */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof AdmissionFault)
    return authoringFailure('invariant-violation', 'candidate', error.message, [], error.source);
  return authoringFailure(
    'corrupt-record',
    'candidate',
    'Candidate ownership validation could not complete',
  );
}
