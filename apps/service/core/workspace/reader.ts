/*
 * Why this file exists
 *
 * Authoring stores a workspace as plain records. Before the service renders or searches them, each
 * must be checked by the capability that owns it: collections by Model, the catalog by Library, the
 * themes and recipes by Templates. For example, a stored collection that Model refuses stops the
 * read with `invariant-violation` at that record's ID; it is never quietly skipped.
 *
 * This file runs those checks and answers the checked contents. Each check answers a `Result`
 * (contract/errors.ts), and the first mistake stops the read. It never writes, and never answers
 * half-checked contents.
 */
import type {
  AuthoringResult,
  Collection,
  LibrarySnapshot,
  LoweredIntent,
  Snapshot,
  StoredRecord,
  Templates,
} from '../../contract/records/capability-types.js';
import type { LibraryRules, ModelRules } from '../../contract/ports/capabilities.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import { authoringFailure, success } from '../../contract/errors.js';
import { projectCollection } from './collection-projection.js';
import { listLiveRecords } from './records.js';

/** The capability checks the reader runs. Compose passes them in. */
export interface WorkspaceReaderDependencies {
  /** Model's check of one collection. */
  readonly model: Pick<ModelRules, 'validate'>;
  /** Library's check of the catalog against the checked collections. */
  readonly library: Pick<LibraryRules, 'validateSnapshot'>;
  /** Templates' check of the stored themes and recipes. */
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog'>;
}

/**
 * Builds the workspace reader (see `WorkspaceReader`). `read` answers the checked collections,
 * catalog and presets, or `invariant-violation` for the first record a check refuses. `project`
 * is `projectCollection`. Starts no I/O.
 */
export function createWorkspaceReader(dependencies: WorkspaceReaderDependencies): WorkspaceReader {
  return { read: (snapshot) => read(snapshot, dependencies), project: projectCollection };
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
  dependencies: WorkspaceReaderDependencies,
): AuthoringResult<WorkspaceContents> {
  const records = listLiveRecords(snapshot, 'collection');
  const collections = records.reduce<AuthoringResult<readonly Collection[]>>(
    (checked, record) => collection(checked, record, dependencies.model),
    success([]),
  );
  if (!collections.ok) return collections;
  return complete(snapshot, collections.value, dependencies);
}

/**
 * One reduce step over the collection records. An earlier failure passes through unchanged;
 * otherwise the record is checked and added (see `checkedCollection`).
 */
function collection(
  records: AuthoringResult<readonly Collection[]>,
  record: StoredRecord,
  model: WorkspaceReaderDependencies['model'],
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
  model: WorkspaceReaderDependencies['model'],
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
  dependencies: WorkspaceReaderDependencies,
): AuthoringResult<WorkspaceContents> {
  const catalogs = listLiveRecords(snapshot, 'catalog');
  if (catalogs.length !== 1)
    return authoringFailure(
      'invariant-violation',
      'catalog',
      'Workspace requires exactly one catalog',
    );
  return checkedLibrary(catalogs[0]?.value, snapshot, collections, dependencies);
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
  dependencies: WorkspaceReaderDependencies,
): AuthoringResult<WorkspaceContents> {
  const library = dependencies.library.validateSnapshot({
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
  return checkedPresets(snapshot, collections, library.value, dependencies.templates);
}

/**
 * Checks the live preset records with Templates and answers the complete contents. A Templates
 * rejection is `invariant-violation` at `presets`, Templates' message and failure kept.
 */
function checkedPresets(
  snapshot: Snapshot,
  collections: readonly Collection[],
  library: LibrarySnapshot,
  templates: WorkspaceReaderDependencies['templates'],
): AuthoringResult<WorkspaceContents> {
  const presets = templates.readCatalog(
    listLiveRecords(snapshot, 'preset').map((record) => record.value),
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
