import type {
  OrganisationChange,
  LibrarySnapshot,
  QueryPage,
  QueryRequest,
  RecentVisit,
  FolderId,
} from '@novakai/canvas-library';
import type { Snapshot, Collection, Receipt } from './owners.js';
import type { Result, Diagnostic } from '../errors.js';
import type { DraftRetention } from '../ports/draft-retention.js';
/** Browse filters are browser preferences; catalog structure remains Library-owned canonical data. */
export interface LibraryFilters {
  readonly text: string;
  readonly folder: string | null;
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
    cursor: string | null,
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
  visit(collection: string): void;
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
  now(): number;
  nextFolderId(): FolderId;
  apply(
    base: Snapshot,
    changes: readonly OrganisationChange[],
  ): Promise<Result<Receipt>>;
  report(error: Diagnostic): void;
}
export type LibraryFactory = (
  callbacks: Pick<LibraryBindings, 'apply' | 'report'>,
) => LibraryController;
