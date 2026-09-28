/*
 * The Library panel's store: browse filters and result pages, the new-folder form and recent visits.
 * Not pure: it holds the view React reads and calls the Library reader, browser storage and Authoring.
 * Recovery: the folder form and the visits are kept in browser storage per workspace and restored
 * with the next snapshot; a stored value that cannot be read is reported and kept. Authoring owns
 * the catalog; a folder change prepared against an older revision is refused (`library-changed`).
 */
import type {
  LibraryBindings,
  LibraryController,
  LibraryView,
  LibraryFilters,
  FolderDraft,
} from '../../contract/records/library.js';
import type { Snapshot, Collection } from '../../contract/records/owners.js';
import type { CollectionId, LibraryCursor, WorkspaceId } from '../../contract/brands.js';
import type { LibrarySnapshot, OrganisationChange, RecentVisit } from '@novakai/canvas-library';
import { diagnostic, type Result } from '../../contract/errors.js';
import { defaultLibraryFilters } from '../../contract/api.js';
/** Creates the store. Failures go to the view's `problem` or to `bindings.report`; nothing throws. */
export function createLibraryController(bindings: LibraryBindings): LibraryController {
  let state: LibraryView = {
    source: null,
    page: null,
    problem: null,
    folderDraft: null,
    filters: defaultLibraryFilters,
  };
  let base: Snapshot | null = null;
  let recent: readonly RecentVisit[] = [];
  const listeners = new Set<() => void>();
  /** One cached snapshot prevents React external-store rerender loops. */
  function publish(patch: Partial<LibraryView>): void {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  /** A new canonical revision invalidates paging, never the user's query. Fails: `invalid-library`. */
  function refresh(
    snapshot: Snapshot,
    collections: readonly Collection[],
  ): void {
    if (snapshot.workspace !== base?.workspace) restoreLocal(snapshot.workspace);
    const checked = bindings.reader.read(snapshot, collections, recent);
    if (!checked.ok) {
      publish({ problem: checked.error });
      return;
    }
    base = snapshot;
    publish({ source: checked.value });
    search(null);
  }
  /** A new workspace drops the prior folder form. Reports `draft-retention-unavailable`. */
  function restoreLocal(workspace: WorkspaceId): void {
    publish({ folderDraft: null });
    restoreVisits(workspace);
    const stored = bindings.retention.read({ slot: 'folder-draft', workspace });
    if (!stored.ok) {
      bindings.report(stored.error);
      return;
    }
    restoreFolder(stored.value);
  }
  /** Restores a stored folder form. Reports `invalid-folder-draft`; the stored value is kept. */
  function restoreFolder(input: unknown): void {
    if (input === null) return;
    const checked = bindings.reader.folderDraft(input);
    if (!checked.ok) {
      bindings.report(checked.error);
      return;
    }
    publish({ folderDraft: checked.value });
  }
  /** Keeps the form, blank titles included, in storage. Fails: `draft-retention-unavailable`. */
  function saveFolder(folderDraft: FolderDraft | null): void {
    if (base === null) return;
    const result = bindings.retention.write(
      { slot: 'folder-draft', workspace: base.workspace },
      folderDraft,
    );
    publish({ folderDraft });
    if (!result.ok) publish({ problem: result.error });
  }
  /** ID and revision are taken on the first edit only. Fails: `id-unavailable` (no draft is made). */
  function editFolderTitle(title: string): void {
    if (state.source === null) return;
    const original = openOrNewFolderDraft(state.source);
    if (!original.ok) return publish({ problem: original.error });
    saveFolder({ ...original.value, title });
  }
  /** The open folder draft, or a new one. Fails: `id-unavailable` when no folder ID is made. */
  function openOrNewFolderDraft(source: LibrarySnapshot): Result<FolderDraft> {
    if (state.folderDraft !== null) return { ok: true, value: state.folderDraft };
    const id = bindings.nextFolderId();
    if (!id.ok) return id;
    return {
      ok: true,
      value: { id: id.value, title: '', revision: source.organisation.revision },
    };
  }
  /** Clears only the exact form Authoring confirmed. Fails: `library-changed`, Authoring's refusal. */
  async function createFolder(): Promise<void> {
    const draft = state.folderDraft;
    if (draft === null) return;
    const created = await commit(
      [
        {
          op: 'create-folder',
          value: {
            id: draft.id,
            title: draft.title,
            order: state.source?.organisation.folders.length ?? 0,
          },
        },
      ],
      draft.revision,
    );
    if (created) acknowledgeFolder(draft);
  }
  /** A concurrent edit cannot be erased by an earlier confirmation. */
  function acknowledgeFolder(draft: FolderDraft): void {
    if (state.folderDraft === draft) saveFolder(null);
  }
  /** Restores stored visits, apart from the catalog. Reports `draft-retention-unavailable`. */
  function restoreVisits(workspace: WorkspaceId): void {
    recent = [];
    const stored = bindings.retention.read({ slot: 'visits', workspace });
    if (!stored.ok) {
      bindings.report(stored.error);
      return;
    }
    readVisits(stored.value);
  }
  /** Reads stored visits. Reports `invalid-visits`; the stored value is kept. */
  function readVisits(input: unknown): void {
    if (input === null) return;
    const checked = bindings.reader.visits(input);
    if (!checked.ok) {
      bindings.report(checked.error);
      return;
    }
    recent = checked.value;
  }
  /** Library owns matching, ranking and cursor consistency. Fails: `invalid-library`. */
  function search(cursor: LibraryCursor | null): void {
    if (state.source === null) return;
    const result = bindings.reader.query(state.source, state.filters, cursor);
    if (!result.ok) {
      publish({ page: null, problem: result.error });
      return;
    }
    publish({ page: result.value, problem: null });
  }
  /** Filter changes start a fresh owner query rather than reusing an incompatible cursor. */
  function filter(filters: LibraryFilters): void {
    publish({ filters });
    search(null);
  }
  /** A visit becomes a preference only for an existing collection; no fabricated ID enters the stored list. */
  function visit(id: CollectionId): void {
    const collection = state.source?.collections.find((item) => item.id === id);
    if (collection === undefined) return;
    storeVisit({ collection: collection.id, openedAt: bindings.now() });
  }
  /** Checks the visit list before storing it. Reports `invalid-visits`. */
  function storeVisit(visit: RecentVisit): void {
    if (base === null) return;
    const checked = bindings.reader.visits(
      [visit, ...recent.filter((item) => item.collection !== visit.collection)].slice(0, 10000),
    );
    if (!checked.ok) {
      bindings.report(checked.error);
      return;
    }
    storeCheckedVisits(base.workspace, checked.value);
  }
  /** Stores checked visits, then ranks with them. Reports `draft-retention-unavailable`. */
  function storeCheckedVisits(
    workspace: WorkspaceId,
    visits: readonly RecentVisit[],
  ): void {
    const stored = bindings.retention.write({ slot: 'visits', workspace }, visits);
    if (!stored.ok) {
      bindings.report(stored.error);
      return;
    }
    recent = visits;
    refreshRecent();
  }
  /** Updating a visit does not advance the captured canonical revision. */
  function refreshRecent(): void {
    if (state.source === null) return;
    publish({ source: { ...state.source, recent } });
    search(null);
  }
  /** Refuses a form prepared against an older catalog; no overwrite or rebase. Fails: `library-changed`. */
  async function commit(
    changes: readonly OrganisationChange[],
    revision: number,
  ): Promise<boolean> {
    if (base === null) return false;
    if (state.source?.organisation.revision !== revision) {
      publish({
        problem: diagnostic(
          'library-changed',
          'The library changed while this edit was being prepared',
          'Review the current folders before submitting a new edit.',
        ),
      });
      return false;
    }
    return applyOrganisation(base, changes);
  }
  /** Sends the change to Authoring. Its refusal goes to `problem`; the folder form is kept. */
  async function applyOrganisation(
    base: Snapshot,
    changes: readonly OrganisationChange[],
  ): Promise<boolean> {
    const result = await bindings.apply(base, changes);
    if (!result.ok) publish({ problem: result.error });
    return result.ok;
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    filter,
    visit,
    apply: async (changes, revision) => {
      await commit(changes, revision);
    },
    editFolderTitle,
    createFolder,
    discardFolder: () => saveFolder(null),
    next: () => search(state.page?.nextCursor ?? null),
  };
}
