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
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
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

/**
 * Reads the candidate and checks its collections, presets and metadata, in that order. Answers
 * the version of every record in `before` except history. A failed check throws `AdmissionFault`,
 * which `validate` turns into a failure (see `rejected`). Reader failures pass through unchanged.
 */
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

/**
 * Checks each collection: its record exists at the collection's revision and retains exactly the
 * resources the selector expects. Throws `AdmissionFault` when the record is missing, the
 * revision or resources differ, or the selector fails (the selector's failure kept as source).
 */
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

/** The live record with this kind and ID. Throws `AdmissionFault` when there is none. */
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

/**
 * The private fault that stops the checks: a message and, for an owner's failure, its source.
 * Only `rejected` reads it; it never leaves `validate`.
 */
class AdmissionFault extends Error {
  /** A fault with this message; `source` is the owner's failure when an owner refused. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}

/** Throws `AdmissionFault` with this message when the condition is false. */
function requireFact(
  condition: boolean,
  message: string,
): void {
  if (!condition) throw new AdmissionFault(message);
}

/**
 * Throws `AdmissionFault` unless the record retains exactly the expected digests. Order and
 * repeated expected digests are ignored.
 */
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

/**
 * Checks each preset: its record at `preset:<digest>` retains exactly its fonts or assets, and
 * Assets resolves each of those digests. Throws `AdmissionFault` when the record is missing, the
 * resources differ or bytes are missing.
 */
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

/** The digests a preset retains: a theme's fonts, a recipe's assets. Never fails. */
function presetResources(preset: Preset): readonly string[] {
  if (preset.kind === 'theme') return preset.payload.fonts;
  return preset.payload.assets;
}

/**
 * Checks the workspace metadata, the catalog and every asset-admission record. Throws
 * `AdmissionFault` when metadata is missing, invalid or names another workspace; when the
 * catalog record is missing or at another revision; when either retains resources; or when an
 * asset-admission record fails (see `asset`).
 */
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

/**
 * Checks one asset-admission record: valid metadata, stored at `asset:<digest>`, retaining only
 * that digest, and its bytes resolvable in Assets. Throws `AdmissionFault` when any of these fails.
 */
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

/**
 * Turns a thrown fault into a failure: `AdmissionFault` is `invariant-violation` at `candidate`
 * (its source kept); anything else is `corrupt-record` at `candidate`.
 */
function rejected(error: unknown): AuthoringResult<never> {
  if (error instanceof AdmissionFault)
    return authoringFailure('invariant-violation', 'candidate', error.message, [], error.source);
  return authoringFailure(
    'corrupt-record',
    'candidate',
    'Candidate ownership validation could not complete',
  );
}
