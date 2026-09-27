import type { FailureSource } from '../../../contract/records/transport/failure-source.js';
import { failure } from '@novakai/canvas-authoring';
import type {
  CandidateValidator,
  Result,
  Snapshot,
  StoredRecord,
  ReadVersion,
} from '@novakai/canvas-authoring';
import type { Preset } from '@novakai/canvas-templates';
import type { AdmissionOwners } from '../../../contract/ports/admission.js';
import type { WorkspaceContents } from '../../../contract/records/workspace/contents.js';
import { workspaceMetadata, assetMetadata } from '../../../contract/records/workspace/metadata.js';
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
  owners: AdmissionOwners,
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
  owners: AdmissionOwners,
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
  owners: AdmissionOwners,
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
  owners: AdmissionOwners,
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
  owners: AdmissionOwners,
): Result<readonly ReadVersion[]> {
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
function rejected(error: unknown): Result<never> {
  if (error instanceof AdmissionFault)
    return failure('invariant-violation', 'candidate', error.message, [], error.source);
  return failure(
    'corrupt-record',
    'candidate',
    'Candidate ownership validation could not complete',
  );
}
/** Mandatory final gate has no write bypass; Authoring owns scope, conditional commit and all recovery decisions. */
export function createCandidateValidator(owners: AdmissionOwners): CandidateValidator {
  return {
    async validate(before, after): Promise<Result<readonly ReadVersion[]>> {
      try {
        return checked(before, after, owners);
      } catch (error) {
        return rejected(error);
      }
    },
  };
}
