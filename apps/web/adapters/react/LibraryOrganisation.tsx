import type { ComponentType, ReactElement } from 'react';
import type { DesignSlots } from '../../contract/react-types.js';
import type { LibraryFeatureProps } from '../../contract/library-react.js';
import styles from './ObjectEditor.module.css';
/** Folder and collection organisation submit Library commands; they cannot write a catalog directly. */
export function createLibraryOrganisation({
  Field,
  Button,
}: Pick<DesignSlots, 'Field' | 'Button'>): ComponentType<LibraryFeatureProps> {
  /** The typed title captures the catalog revision at the first keystroke, avoiding a silent foreign-edit rebase. */
  function LibraryOrganisation({
    library,
    state,
    busy,
    workspace,
  }: LibraryFeatureProps): ReactElement | null {
    const folderDraft = state.folderDraft;
    const catalog = state.source?.organisation;
    if (catalog === undefined) return null;
    const activeId = workspace.getSnapshot().active?.document.collection.id;
    const entry = catalog.entries.find((entry) => entry.collection === activeId);
    return (
      <div className={styles.editor}>
        <fieldset className={styles.block}>
          <legend>New folder</legend>
          <Field
            label="Folder title"
            control={(props) => (
              <input
                {...props}
                value={folderDraft?.title ?? ''}
                disabled={busy}
                onChange={(event) => library.editFolderTitle(event.target.value)}
              />
            )}
          />
          <Button
            label="Create folder"
            disabled={busy || !folderDraft?.title.trim()}
            onClick={() => {
              if (folderDraft === null) return;
              void library.createFolder();
            }}
          />
          {folderDraft && <Button label="Discard folder draft" onClick={library.discardFolder} />}
        </fieldset>
        {entry && (
          <fieldset className={styles.block}>
            <legend>Open collection</legend>
            <Field
              label="Collection folder"
              control={(props) => (
                <select
                  {...props}
                  value={entry.folder ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const folder = catalog.folders.find(
                      (folder) => folder.id === event.target.value,
                    );
                    const { folder: removed, ...rootEntry } = entry;
                    void removed;
                    const value = folder ? { ...rootEntry, folder: folder.id } : rootEntry;
                    void library.apply([{ op: 'replace-entry', value }], catalog.revision);
                  }}
                >
                  <option value="">Workspace root</option>
                  {catalog.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.title}
                    </option>
                  ))}
                </select>
              )}
            />
            <Button
              label={entry.archived ? 'Restore collection from archive' : 'Archive collection'}
              disabled={busy}
              onClick={() => {
                void library.apply(
                  [{ op: 'replace-entry', value: { ...entry, archived: !entry.archived } }],
                  catalog.revision,
                );
              }}
            />
          </fieldset>
        )}
      </div>
    );
  }
  return LibraryOrganisation;
}
