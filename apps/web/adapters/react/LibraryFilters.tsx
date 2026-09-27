import { useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { DesignSlots } from '../../contract/react-types.js';
import type { LibraryFeatureProps } from '../../contract/library-react.js';
import type { FolderId } from '../../contract/brands.js';
import editorStyles from './ObjectEditor.module.css';
import styles from './LibraryFilters.module.css';
/** Search, folder scope and archive filters use Library's public query semantics. */
export function createLibraryFilters(
  { Field, Button }: Pick<DesignSlots, 'Field' | 'Button'>,
  options: { readonly compact?: boolean } = {},
): ComponentType<LibraryFeatureProps> {
  /** Filter edits change discovery only; they never mutate the diagram or move its camera. */
  function LibraryFilters({ library, state }: LibraryFeatureProps): ReactElement {
    const filters = state.filters;
    const [advancedOpen, setAdvancedOpen] = useState(!options.compact);
    const advanced = (
      <div className={styles.advanced}>
        <Field
          label="Folder"
          control={(props) => (
            <select
              {...props}
              value={filters.folder ?? ''}
              onChange={(event) =>
                library.filter({ ...filters, folder: listedFolder(state, event.target.value) })
              }
            >
              <option value="">All folders</option>
              {state.source?.organisation.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          label="Show collections"
          control={(props) => (
            <select
              {...props}
              value={filters.archived}
              onChange={(event) => {
                const archived = archives.find((item) => item.value === event.target.value)?.value;
                if (archived) library.filter({ ...filters, archived });
              }}
            >
              {archives.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          label="Sort results"
          control={(props) => (
            <select
              {...props}
              value={filters.sort}
              onChange={(event) => {
                const sort = sorts.find((item) => item.value === event.target.value)?.value;
                if (sort) library.filter({ ...filters, sort });
              }}
            >
              {sorts.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        />
        <Button
          label="Reset search"
          onClick={() =>
            library.filter({ text: '', folder: null, archived: 'exclude', sort: 'order' })
          }
        />
      </div>
    );
    return (
      <div className={editorStyles.editor}>
        <Field
          label="Search collections"
          control={(props) => (
            <input
              {...props}
              type="search"
              value={filters.text}
              placeholder="Collection title…"
              onChange={(event) => library.filter({ ...filters, text: event.target.value })}
            />
          )}
        />
        {options.compact ? (
          <details
            className={styles.filters}
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className={styles.summary}>Advanced filters</summary>
            {advanced}
          </details>
        ) : (
          advanced
        )}
      </div>
    );
  }
  return LibraryFilters;
}
/** The listed folder whose ID is `value`; null for "All folders". */
function listedFolder(
  state: LibraryFeatureProps['state'],
  value: string,
): FolderId | null {
  return state.source?.organisation.folders.find((folder) => folder.id === value)?.id ?? null;
}
const archives = [
  { value: 'exclude', label: 'Active' },
  { value: 'only', label: 'Archived' },
  { value: 'include', label: 'Active and archived' },
] as const;
const sorts = [
  { value: 'order', label: 'Library order' },
  { value: 'title', label: 'Title' },
  { value: 'recent', label: 'Recently opened' },
] as const;
