/*
 * The Library panel's starting browse filters. Pure; never fails. The Library store starts from
 * them and Reset search returns to them. Nothing here is stored, so there is nothing to recover.
 */
import type { LibraryFilters } from '../../contract/records/library.js';

/** No search text, every folder, active collections only, in library order. */
export const defaultLibraryFilters: LibraryFilters = Object.freeze({
  text: '',
  folder: null,
  archived: 'exclude',
  sort: 'order',
});
