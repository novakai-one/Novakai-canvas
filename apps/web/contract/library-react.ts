import type { LibraryView, LibraryController } from './records/library.js';
import type { WorkspaceController, WorkspaceView } from './records/workspace.js';
import type { CollectionId } from './brands.js';
/** Library features receive only the workspace roles used by discovery and selection. */
export type LibraryWorkspace = Pick<WorkspaceController, 'library' | 'open' | 'getSnapshot'>;
export type LibraryWorkspaceView = Pick<WorkspaceView, 'busy' | 'connected'>;
/** Library slots consume their own cached session view and explicit navigation actions. */
export interface LibraryFeatureProps {
  readonly library: LibraryController;
  readonly state: LibraryView;
  readonly workspace: LibraryWorkspace;
  readonly busy: boolean;
  readonly onSelect: ((id: CollectionId) => void) | null;
  readonly currentId: CollectionId | null;
  readonly pendingId: CollectionId | null;
}

export interface LibraryBrowserProps {
  readonly controller: LibraryWorkspace;
  readonly view: LibraryWorkspaceView;
  readonly className?: string;
  readonly onSelect?: (id: CollectionId) => void;
  readonly currentId?: CollectionId | null;
  readonly pendingId?: CollectionId | null;
}
