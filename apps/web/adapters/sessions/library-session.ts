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
/** The session owns browse filters and local visits; every catalog mutation goes to Authoring with a captured revision. */
export function createLibraryController(bindings: LibraryBindings): LibraryController {
  let state: LibraryView = {
    source: null,
    page: null,
    problem: null,
    folderDraft: null,
    filters: { text: '', folder: null, archived: 'exclude', sort: 'order' },
  };
  let base: Snapshot | null = null;
  let recent: readonly RecentVisit[] = [];
  const listeners = new Set<() => void>();
  /** One cached snapshot prevents React external-store rerender loops. */
  function publish(patch: Partial<LibraryView>): void {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  /** A new canonical revision invalidates paging, never the user's query. */
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
  /** New workspace preferences cannot inherit a prior workspace's unfinished folder form. */
  function restoreLocal(workspace: WorkspaceId): void {
    publish({ folderDraft: null });
    restoreVisits(workspace);
    const stored = bindings.retention.read(`folder-draft.${workspace}`);
    if (!stored.ok) {
      bindings.report(stored.error);
      return;
    }
    restoreFolder(stored.value);
  }
  /** Invalid recovery is surfaced while the original stored value is retained. */
  function restoreFolder(input: unknown): void {
    if (input === null) return;
    const checked = bindings.reader.folderDraft(input);
    if (!checked.ok) {
      bindings.report(checked.error);
      return;
    }
    publish({ folderDraft: checked.value });
  }
  /** Form data is persisted outside component lifetime, including temporarily blank titles. */
  function saveFolder(folderDraft: FolderDraft | null): void {
    if (base === null) return;
    const result = bindings.retention.write(`folder-draft.${base.workspace}`, folderDraft);
    publish({ folderDraft });
    if (!result.ok) publish({ problem: result.error });
  }
  /** Identity and catalog revision are allocated on the first edit only; no ID, no draft. */
  function editFolderTitle(title: string): void {
    if (state.source === null) return;
    const original = folderDraft(state.source);
    if (!original.ok) return publish({ problem: original.error });
    saveFolder({ ...original.value, title });
  }
  /** The open folder draft, or a new one. Fails with `id-unavailable` when no folder ID is made. */
  function folderDraft(source: LibrarySnapshot): Result<FolderDraft> {
    if (state.folderDraft !== null) return { ok: true, value: state.folderDraft };
    const id = bindings.nextFolderId();
    if (!id.ok) return id;
    return {
      ok: true,
      value: { id: id.value, title: '', revision: source.organisation.revision },
    };
  }
  /** Confirmed creation clears only the exact submitted form; failed or newer typing remains retained. */
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
  /** Stored visits are optional local preferences, admitted independently from canonical state. */
  function restoreVisits(workspace: WorkspaceId): void {
    recent = [];
    const stored = bindings.retention.read(`visits.${workspace}`);
    if (!stored.ok) {
      bindings.report(stored.error);
      return;
    }
    readVisits(stored.value);
  }
  /** Corrupt visit data is retained; it cannot corrupt catalog membership. */
  function readVisits(input: unknown): void {
    if (input === null) return;
    const checked = bindings.reader.visits(input);
    if (!checked.ok) {
      bindings.report(checked.error);
      return;
    }
    recent = checked.value;
  }
  /** Library owns matching, ranking and cursor consistency. */
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
  /** Visit data is checked before retention, then the owner recomputes recent ranking. */
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
  /** Checked visits are retained before replacing the active ranking preferences. */
  function storeCheckedVisits(
    workspace: WorkspaceId,
    visits: readonly RecentVisit[],
  ): void {
    const stored = bindings.retention.write(`visits.${workspace}`, visits);
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
  /** A form prepared against an older catalog is rejected visibly; no implicit overwrite or rebase occurs. */
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
  /** Typed Authoring failure remains visible and never clears an unconfirmed folder form. */
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
