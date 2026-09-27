/*
 * Reads one Authoring snapshot into checked workspace contents: Model checks every live collection,
 * Library checks the one catalog, Templates checks the stored presets. Pure over the injected
 * owners. On any rejection Authoring keeps its current snapshot; no partial contents are returned.
 */
import type {
  AuthoringResult,
  Collection,
  LibrarySnapshot,
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
import { liveRecords } from './records.js';

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
 * Checks the live collection, catalog and preset records of one snapshot. Fails with
 * `invariant-violation` at:
 * - the record ID, when Model rejects a collection (Model's failure kept as source);
 * - `catalog`, when there is not exactly one catalog, or Library rejects it (source kept);
 * - `presets`, when Templates rejects the stored presets (Templates' message and source kept).
 */
function read(
  snapshot: Snapshot,
  owners: WorkspaceReaderOwners,
): AuthoringResult<WorkspaceContents> {
  const records = liveRecords(snapshot, 'collection');
  const collections = records.reduce<AuthoringResult<readonly Collection[]>>(
    (checked, record) => collection(checked, record, owners.model),
    success([]),
  );
  if (!collections.ok) return collections;
  return complete(snapshot, collections.value, owners);
}

/**
 * One reduce step over the collection records. An earlier failure passes through unchanged;
 * otherwise the record is checked and added (see `checkedCollection`).
 */
function collection(
  records: AuthoringResult<readonly Collection[]>,
  record: StoredRecord,
  model: WorkspaceReaderOwners['model'],
): AuthoringResult<readonly Collection[]> {
  if (!records.ok) return records;
  return checkedCollection(records.value, record, model);
}

/**
 * Adds one collection record once Model accepts it. A rejected record is `invariant-violation`
 * at its record ID with Model's failure as source, so no invalid member is dropped.
 */
function checkedCollection(
  accepted: readonly Collection[],
  record: StoredRecord,
  model: WorkspaceReaderOwners['model'],
): AuthoringResult<readonly Collection[]> {
  const checked = model.validate(record.value);
  if (!checked.ok)
    return authoringFailure(
      'invariant-violation',
      record.key.id,
      'The owning capability rejected this input',
      [],
      checked.error,
    );
  return success([...accepted, checked.value]);
}

/**
 * Requires exactly one catalog record, then checks it (see `checkedLibrary`). Zero or several
 * catalogs is `invariant-violation` at `catalog`.
 */
function complete(
  snapshot: Snapshot,
  collections: readonly Collection[],
  owners: WorkspaceReaderOwners,
): AuthoringResult<WorkspaceContents> {
  const catalogs = liveRecords(snapshot, 'catalog');
  if (catalogs.length !== 1)
    return authoringFailure(
      'invariant-violation',
      'catalog',
      'Workspace requires exactly one catalog',
    );
  return checkedLibrary(catalogs[0]?.value, snapshot, collections, owners);
}

/**
 * Checks the catalog and the checked collections with Library, then the presets (see
 * `checkedPresets`). A Library rejection is `invariant-violation` at `catalog`, Library's failure
 * kept as source.
 */
function checkedLibrary(
  catalog: unknown,
  snapshot: Snapshot,
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
  return checkedPresets(snapshot, collections, library.value, owners.templates);
}

/**
 * Checks the live preset records with Templates and answers the complete contents. A Templates
 * rejection is `invariant-violation` at `presets`, Templates' message and failure kept.
 */
function checkedPresets(
  snapshot: Snapshot,
  collections: readonly Collection[],
  library: LibrarySnapshot,
  templates: WorkspaceReaderOwners['templates'],
): AuthoringResult<WorkspaceContents> {
  const presets = templates.readCatalog(
    liveRecords(snapshot, 'preset').map((record) => record.value),
  );
  if (!presets.ok)
    return authoringFailure(
      'invariant-violation',
      'presets',
      presets.error.message,
      [],
      presets.error,
    );
  return success({ collections, library, presets: presets.value });
}
