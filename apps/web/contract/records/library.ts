import type {
  OrganisationChange,
  LibrarySnapshot,
  QueryPage,
  QueryRequest,
  RecentVisit,
} from '@novakai/canvas-library';
import type { CollectionId, FolderId, LibraryCursor, VisitTime } from '../brands.js';
import type { Snapshot, Collection, Receipt } from './owners.js';
import type { Result, Diagnostic } from '../errors.js';
import type { DraftRetention } from '../ports/draft-retention.js';
/** Browse filters are browser preferences; catalog structure remains Library-owned canonical data. */
export interface LibraryFilters {
  readonly text: string;
  readonly folder: FolderId | null;
  readonly archived: QueryRequest['archived'];
  readonly sort: QueryRequest['sort'];
}
export interface LibraryView {
  readonly source: LibrarySnapshot | null;
  readonly filters: LibraryFilters;
  readonly page: QueryPage | null;
  readonly problem: Diagnostic | null;
  readonly folderDraft: FolderDraft | null;
}
/** New-folder identity and revision are captured once; retries never allocate another folder. */
export interface FolderDraft {
  readonly id: FolderId;
  readonly title: string;
  readonly revision: number;
}
export interface LibraryReader {
  read(
    snapshot: Snapshot,
    collections: readonly Collection[],
    recent: readonly RecentVisit[],
  ): Result<LibrarySnapshot>;
  query(
    snapshot: LibrarySnapshot,
    filters: LibraryFilters,
    cursor: LibraryCursor | null,
  ): Result<QueryPage>;
  visits(input: unknown): Result<readonly RecentVisit[]>;
  folderDraft(input: unknown): Result<FolderDraft>;
}
/** Discovery and catalog commands are independent of the mounted library/panel components. */
export interface LibraryController {
  getSnapshot(): LibraryView;
  subscribe(listener: () => void): () => void;
  refresh(
    snapshot: Snapshot,
    collections: readonly Collection[],
  ): void;
  filter(filters: LibraryFilters): void;
  next(): void;
  visit(collection: CollectionId): void;
  apply(
    changes: readonly OrganisationChange[],
    revision: number,
  ): Promise<void>;
  editFolderTitle(title: string): void;
  createFolder(): Promise<void>;
  discardFolder(): void;
}
export interface LibraryBindings {
  readonly reader: LibraryReader;
  readonly retention: DraftRetention;
  /** The time a collection is opened, recorded as a Library visit. */
  now(): VisitTime;
  /** A new folder ID from the ID source. Fails with `id-unavailable`. */
  nextFolderId(): Result<FolderId>;
  apply(
    base: Snapshot,
    changes: readonly OrganisationChange[],
  ): Promise<Result<Receipt>>;
  report(error: Diagnostic): void;
}
export type LibraryFactory = (
  callbacks: Pick<LibraryBindings, 'apply' | 'report'>,
) => LibraryController;
