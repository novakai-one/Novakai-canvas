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
  Catalog,
  Collection,
  Json,
  LibrarySnapshot,
  LoweredIntent,
  Snapshot,
  StoredRecord,
  Templates,
} from '../../contract/records/capability-types.js';
import type { LibraryRules, ModelRules } from '../../contract/ports/capabilities.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type {
  CapabilityFailure,
  FailureSource,
} from '../../contract/records/transport/failure-source.js';
import { authoringFailure, collect, success } from '../../contract/errors.js';
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
  return {
    read: (snapshot) => readWorkspaceContents(snapshot, dependencies),
    project: projectCollection,
  };
}

/** The message a record gets when the capability that owns it refuses it. */
const REFUSED_MESSAGE = 'The owning capability rejected this input';

/** The checked collections, and the catalog Library checked against them. */
type CollectionsAndCatalog = Pick<WorkspaceContents, 'collections' | 'library'>;

/** Checks the live collections and the catalog, then the presets, of one snapshot. */
function readWorkspaceContents(
  snapshot: Snapshot,
  dependencies: WorkspaceReaderDependencies,
): AuthoringResult<WorkspaceContents> {
  const collectionsAndCatalog = checkCollectionsAndCatalog(snapshot, dependencies);
  if (!collectionsAndCatalog.ok) {
    return collectionsAndCatalog;
  }
  const presets = checkPresets(snapshot, dependencies.templates);
  if (!presets.ok) {
    return presets;
  }
  return success({ ...collectionsAndCatalog.value, presets: presets.value });
}

/** Checks the collections with Model, then the catalog with Library against those collections. */
function checkCollectionsAndCatalog(
  snapshot: Snapshot,
  dependencies: WorkspaceReaderDependencies,
): AuthoringResult<CollectionsAndCatalog> {
  const collections = checkCollections(snapshot, dependencies.model);
  if (!collections.ok) {
    return collections;
  }
  const library = checkCatalog(snapshot, collections.value, dependencies.library);
  if (!library.ok) {
    return library;
  }
  return success({ collections: collections.value, library: library.value });
}

/** Checks each live collection record with Model, in snapshot order; the first refusal stops it. */
function checkCollections(
  snapshot: Snapshot,
  model: WorkspaceReaderDependencies['model'],
): AuthoringResult<readonly Collection[]> {
  const records = listLiveRecords(snapshot, 'collection');
  return collect(records, (record) => checkCollection(record, model));
}

/** Checks one collection record with Model. */
function checkCollection(
  record: StoredRecord,
  model: WorkspaceReaderDependencies['model'],
): AuthoringResult<Collection> {
  const collection = model.validate(record.value);
  if (!collection.ok) {
    return refusedRecordFailure(record.key.id, collection.error);
  }
  return success(collection.value);
}

/** Finds the one catalog record, then checks it with Library against the checked collections. */
function checkCatalog(
  snapshot: Snapshot,
  collections: readonly Collection[],
  library: WorkspaceReaderDependencies['library'],
): AuthoringResult<LibrarySnapshot> {
  const storedCatalog = findSingleCatalog(snapshot);
  if (!storedCatalog.ok) {
    return storedCatalog;
  }
  const summaries = collections.map(projectCollection);
  const catalog = library.validateSnapshot({
    organisation: storedCatalog.value,
    collections: summaries,
    recent: [],
  });
  if (!catalog.ok) {
    return refusedRecordFailure('catalog', catalog.error);
  }
  return success(catalog.value);
}

/** Finds the stored contents of the workspace's single live catalog record. */
function findSingleCatalog(snapshot: Snapshot): AuthoringResult<Json> {
  const catalogs = listLiveRecords(snapshot, 'catalog');
  if (!isExactlyOne(catalogs)) {
    return catalogCountFailure();
  }
  return success(catalogs[0].value);
}

/** Whether the list holds exactly one record. */
function isExactlyOne(records: readonly StoredRecord[]): records is readonly [StoredRecord] {
  return records.length === 1;
}

/** Checks the live preset records (the stored themes and recipes) with Templates. */
function checkPresets(
  snapshot: Snapshot,
  templates: WorkspaceReaderDependencies['templates'],
): AuthoringResult<Catalog> {
  const records = listLiveRecords(snapshot, 'preset');
  const storedPresets = records.map((record) => record.value);
  const presets = templates.readCatalog(storedPresets);
  if (!presets.ok) {
    return refusedPresetsFailure(presets.error);
  }
  return success(presets.value);
}

/**
 * Makes the mistake for a record its capability refused (`invariant-violation` at `path`), keeping
 * the refusal as `source`.
 */
function refusedRecordFailure(
  path: string,
  refusal: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('invariant-violation', path, REFUSED_MESSAGE, [], refusal);
}

/** Makes the mistake for a workspace without exactly one catalog (`invariant-violation`). */
function catalogCountFailure(): AuthoringResult<never> {
  return authoringFailure(
    'invariant-violation',
    'catalog',
    'Workspace requires exactly one catalog',
  );
}

/**
 * Makes the mistake for presets Templates refused (`invariant-violation` at `presets`), keeping
 * Templates' message and failure.
 */
function refusedPresetsFailure(refusal: CapabilityFailure): AuthoringResult<never> {
  return authoringFailure('invariant-violation', 'presets', refusal.message, [], refusal);
}
