import { projectCollection } from '../../contract/api.js';
import { validate as validateModel } from '@novakai/canvas-model';
import { validateLibrarySnapshot } from '@novakai/canvas-library';
import { failure } from '@novakai/canvas-authoring';
import type { Snapshot, Result, StoredRecord } from '@novakai/canvas-authoring';
import type { Collection } from '@novakai/canvas-model';
import type {
  WorkspaceReader,
  WorkspaceReaderOwners,
  WorkspaceContents,
} from '../../contract/records/workspace/contents.js';
/** Preserve owner rejection across typed record accumulation; no invalid member is dropped from a workspace. */
function collection(
  records: Result<readonly Collection[]>,
  record: StoredRecord,
): Result<readonly Collection[]> {
  if (!records.ok) return records;
  const checked = validateModel(record.value);
  if (!checked.ok)
    return failure(
      'invariant-violation',
      record.key.id,
      'The owning capability rejected this input',
      [],
      checked.error,
    );
  return { ok: true, value: [...records.value, checked.value] };
}
/** Complete workspace decoding composes owner validation; final Authoring validation supplies the exact stamped candidate. */
function read(
  snapshot: Snapshot,
  owners: WorkspaceReaderOwners,
): Result<WorkspaceContents> {
  const live = snapshot.records.filter((record) => !record.deleted);
  const collections = live
    .filter((record) => record.key.kind === 'collection')
    .reduce<Result<readonly Collection[]>>(collection, { ok: true, value: [] });
  if (!collections.ok) return collections;
  return complete(live, collections.value, owners);
}
/** Catalog membership and all immutable preset hashes are checked before any consumer receives a workspace view. */
function complete(
  live: readonly StoredRecord[],
  collections: readonly Collection[],
  owners: WorkspaceReaderOwners,
): Result<WorkspaceContents> {
  const catalogs = live.filter((record) => record.key.kind === 'catalog');
  if (catalogs.length !== 1)
    return failure('invariant-violation', 'catalog', 'Workspace requires exactly one catalog');
  return checkedCatalogs(catalogs[0]?.value, live, collections, owners);
}
/** Distinct owner failures retain a stable Authoring diagnostic and never become a partially populated inventory. */
function checkedCatalogs(
  catalog: unknown,
  live: readonly StoredRecord[],
  collections: readonly Collection[],
  owners: WorkspaceReaderOwners,
): Result<WorkspaceContents> {
  const library = validateLibrarySnapshot({
    organisation: catalog,
    collections: collections.map(projectCollection),
    recent: [],
  });
  if (!library.ok)
    return failure(
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
    return failure('invariant-violation', 'presets', presets.error.message, [], presets.error);
  return { ok: true, value: { collections, library: library.value, presets: presets.value } };
}
/** Read-only bridge; Authoring retains the current snapshot if an owner rejects any canonical participant. */
export function createWorkspaceReader(owners: WorkspaceReaderOwners): WorkspaceReader {
  return { read: (snapshot) => read(snapshot, owners), project: projectCollection };
}
