/*
 * The inputs a render request captures when it starts: the collection, its revision in the checked
 * catalogue, the workspace, the service generation, and whether navigation or the collection
 * chooser asked. Admission later compares the view and the delivered document with these. Pure;
 * the session owns the request token and the transport abort.
 */
import type { Collection } from '../../../contract/records/owners.js';
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import type { WorkspaceScope } from '../../../contract/records/workspace-scope.js';
import type { ReadGeneration } from '../../../contract/records/read-generation.js';
import { snapshotScope } from '../workspace-scope.js';

/** Who asked for the render: ordinary navigation, or the collection chooser. */
export type RenderMode = 'navigation' | 'chooser';

/** What a render request captured when it started. */
export interface RenderTicket {
  readonly id: string;
  /** The collection's revision in the catalogue; -1 when it was not listed. */
  readonly revision: number;
  /** The checked snapshot's workspace; unrestored before the first snapshot. */
  readonly workspace: WorkspaceScope;
  /** The view's read generation; unread before the first workspace read. */
  readonly generation: ReadGeneration;
  readonly mode: RenderMode;
}

/** The parts of the workspace view a ticket reads. */
export type TicketView = Pick<WorkspaceView, 'collections' | 'snapshot' | 'generation'>;

/** The ticket for rendering `id` from the current view. */
export function renderTicket(
  view: TicketView,
  id: string,
  mode: RenderMode,
): RenderTicket {
  return {
    id,
    revision: listedRevision(view.collections, id),
    workspace: snapshotScope(view.snapshot),
    generation: view.generation,
    mode,
  };
}

/** A collection's revision in the catalogue; -1 when it is not listed. */
export function listedRevision(
  collections: readonly Collection[],
  id: string,
): number {
  return collections.find((item) => item.id === id)?.revision ?? -1;
}
