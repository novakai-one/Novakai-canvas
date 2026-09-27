import { useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { DesignSlots } from '../../contract/react-types.js';
import type { LibraryFeatureProps } from '../../contract/library-react.js';
import type { FolderId } from '../../contract/brands.js';
import { defaultLibraryFilters } from '../../contract/api.js';
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
    const folders = folderChoices(state);
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
                library.filter({ ...filters, folder: chosen(folders, event.target.value) ?? null })
              }
            >
              <option value="">All folders</option>
              {choiceOptions(folders)}
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
                const archived = chosen(archives, event.target.value);
                if (archived) library.filter({ ...filters, archived });
              }}
            >
              {choiceOptions(archives)}
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
                const sort = chosen(sorts, event.target.value);
                if (sort) library.filter({ ...filters, sort });
              }}
            >
              {choiceOptions(sorts)}
            </select>
          )}
        />
        <Button label="Reset search" onClick={() => library.filter(defaultLibraryFilters)} />
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
/** One option in a filter select: the value the filter takes and the text shown. */
interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}
/** The listed folders as choices, in catalog order; none before the catalog is read. */
function folderChoices(state: LibraryFeatureProps['state']): readonly Choice<FolderId>[] {
  const folders = state.source?.organisation.folders ?? [];
  return folders.map((folder) => ({ value: folder.id, label: folder.title }));
}
/** The listed value whose text is `text`; undefined when no choice has it ("All folders"). */
function chosen<T extends string>(
  choices: readonly Choice<T>[],
  text: string,
): T | undefined {
  return choices.find((choice) => choice.value === text)?.value;
}
/** One `<option>` per choice, in order. */
function choiceOptions<T extends string>(choices: readonly Choice<T>[]): readonly ReactElement[] {
  return choices.map((choice) => (
    <option key={choice.value} value={choice.value}>
      {choice.label}
    </option>
  ));
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
