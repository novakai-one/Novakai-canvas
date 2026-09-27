/*
 * Reads one Authoring snapshot into checked workspace contents: Model checks every live collection,
 * Library checks the one catalog, Templates checks the stored presets. Pure over the injected
 * owners. On any rejection Authoring keeps its current snapshot; no partial contents are returned.
 */
import type {
  AuthoringResult,
  Collection,
  LoweredIntent,
  Snapshot,
  StoredRecord,
  Templates,
} from '../../contract/records/capabilities.js';
import type { LibraryRules, ModelRules } from '../../contract/ports/capabilities.js';
import type {
  WorkspaceContents,
  WorkspaceReader,
} from '../../contract/records/workspace/contents.js';
import { authoringFailure, success } from '../../contract/errors.js';
import { projectCollection } from './collection-projection.js';

/** The capability checks the reader runs; compose passes them from ServiceCapabilities. */
export interface WorkspaceReaderOwners {
  readonly model: Pick<ModelRules, 'validate'>;
  readonly library: Pick<LibraryRules, 'validateSnapshot'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog'>;
}

/**
 * Binds the workspace reader to its owners. `read` answers the checked contents or Authoring's
 * `invariant-violation` (see `read`); `project` is `projectCollection`. Starts no I/O.
 */
export function createWorkspaceReader(owners: WorkspaceReaderOwners): WorkspaceReader {
  return { read: (snapshot) => read(snapshot, owners), project: projectCollection };
}

/**
 * Checks every live record of one snapshot. Fails with `invariant-violation` at:
 * - the record ID, when Model rejects a collection (Model's failure kept as source);
 * - `catalog`, when there is not exactly one catalog, or Library rejects it (source kept);
 * - `presets`, when Templates rejects the stored presets (Templates' message and source kept).
 */
function read(
  snapshot: Snapshot,
  owners: WorkspaceReaderOwners,
): AuthoringResult<WorkspaceContents> {
  const live = snapshot.records.filter((record) => !record.deleted);
  const collections = live
    .filter((record) => record.key.kind === 'collection')
    .reduce<AuthoringResult<readonly Collection[]>>(
      (checked, record) => collection(checked, record, owners.model),
      success([]),
    );
  if (!collections.ok) return collections;
  return complete(live, collections.value, owners);
}

/**
 * Adds one collection record once Model accepts it. An earlier failure passes through unchanged;
 * a rejected record is `invariant-violation` at its record ID, so no invalid member is dropped.
 */
function collection(
  records: AuthoringResult<readonly Collection[]>,
  record: StoredRecord,
  model: WorkspaceReaderOwners['model'],
): AuthoringResult<readonly Collection[]> {
  if (!records.ok) return records;
  const checked = model.validate(record.value);
  if (!checked.ok)
    return authoringFailure(
      'invariant-violation',
      record.key.id,
      'The owning capability rejected this input',
      [],
      checked.error,
    );
  return success([...records.value, checked.value]);
}

/**
 * Requires exactly one catalog record, then checks it (see `checkedCatalogs`). Zero or several
 * catalogs is `invariant-violation` at `catalog`.
 */
function complete(
  live: readonly StoredRecord[],
  collections: readonly Collection[],
  owners: WorkspaceReaderOwners,
): AuthoringResult<WorkspaceContents> {
  const catalogs = live.filter((record) => record.key.kind === 'catalog');
  if (catalogs.length !== 1)
    return authoringFailure(
      'invariant-violation',
      'catalog',
      'Workspace requires exactly one catalog',
    );
  return checkedCatalogs(catalogs[0]?.value, live, collections, owners);
}

/**
 * Checks the catalog with Library and the stored presets with Templates. A Library rejection is
 * `invariant-violation` at `catalog`; a Templates rejection is `invariant-violation` at `presets`.
 * Both keep the owner's failure as source.
 */
function checkedCatalogs(
  catalog: unknown,
  live: readonly StoredRecord[],
  collections: readonly Collection[],
  owners: WorkspaceReaderOwners,
): AuthoringResult<WorkspaceContents> {
  const library = owners.library.validateSnapshot({
    organisation: catalog,
    collections: collections.map(projectCollection),
    recent: [],
  });
  if (!library.ok)
    return authoringFailure(
      'invariant-violation',
      'catalog',
      'The owning capability rejected this input',
      [],
      library.error,
    );
  const presets = owners.templates.readCatalog(
    live.filter((record) => record.key.kind === 'preset').map((record) => record.value),
  );
  if (!presets.ok)
    return authoringFailure(
      'invariant-violation',
      'presets',
      presets.error.message,
      [],
      presets.error,
    );
  return success({ collections, library: library.value, presets: presets.value });
}
