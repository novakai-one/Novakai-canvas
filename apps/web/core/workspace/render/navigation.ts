/*
 * Moving between collections: which snapshots the view accepts, what a snapshot does to the open
 * collection, and the collection switch (begin, choose, retry, cancel). A snapshot reopens the open
 * collection only when its revision or generation moved and the current request does not already
 * cover it; a collection that has left the catalogue returns the view to the library. Pure; the
 * session aborts requests, disposes sessions and opens collections.
 */
import type { Snapshot } from '../../../contract/records/owners.js';
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../../contract/records/active-diagram.js';
import type { ReadGeneration } from '../../../contract/records/read-generation.js';
import type { CollectionId, TransportGeneration } from '../../../contract/brands.js';
import { atGeneration, sameGeneration } from '../read-generation.js';
import { renderChanged } from '../session-reuse.js';
import { activeCollectionId, problemAfterRender, type ViewPatch } from './patches.js';
import type { RenderTicket } from '../diagram/ticket.js';

/** What a snapshot means for the open collection: nothing, gone from the catalogue, or reopen. */
export type ActiveRefresh =
  | { readonly kind: 'none' }
  | { readonly kind: 'gone'; readonly active: ActiveDiagram }
  | { readonly kind: 'reopen'; readonly id: CollectionId };

/** Choosing a collection: the open one cancels the switch; another opens, beginning the switch when idle. */
export type ChoosePlan = 'cancel' | 'begin' | 'open';

/** The parts of the workspace view a refresh reads. */
export type RefreshView = Pick<
  WorkspaceView,
  'active' | 'collectionSwitch' | 'collections' | 'generation'
>;

/** An older sequence of the same generation arrived out of order; the view keeps the newer one. */
export function staleSnapshot(
  view: Pick<WorkspaceView, 'generation' | 'snapshot'>,
  snapshot: Snapshot,
  generation: TransportGeneration,
): boolean {
  return (
    atGeneration(view.generation, generation) && snapshot.sequence < (view.snapshot?.sequence ?? 0)
  );
}

/** What a snapshot does to the open collection; nothing while the collection switch is open. */
export function activeRefresh(
  view: RefreshView,
  rendering: RenderTicket | null,
): ActiveRefresh {
  const active = view.active;
  if (active === null || view.collectionSwitch.phase !== 'idle') return { kind: 'none' };
  return displayedRefresh(view, active, rendering);
}

/** The view once the open collection has left the catalogue. */
export function gonePatch(): ViewPatch {
  return { active: null, opening: null, status: 'Collection is no longer available' };
}

/** The switch opens on the current collection; nothing is opening. */
export function choosingPatch(view: Pick<WorkspaceView, 'active' | 'problem'>): ViewPatch {
  return {
    opening: null,
    collectionSwitch: { phase: 'choosing', activeId: activeCollectionId(view) },
    ...problemAfterRender(view),
  };
}

/** What choosing `id` does. */
export function choosePlan(
  view: Pick<WorkspaceView, 'active' | 'collectionSwitch'>,
  id: CollectionId,
): ChoosePlan {
  if (id === activeCollectionId(view)) return 'cancel';
  return view.collectionSwitch.phase === 'idle' ? 'begin' : 'open';
}

/** The switch closes on the current collection; the library rests on "Ready", a diagram on `editing`. */
export function closedSwitchPatch(
  view: Pick<WorkspaceView, 'active' | 'problem'>,
  editing: string,
): ViewPatch {
  return {
    opening: null,
    collectionSwitch: { phase: 'idle', activeId: activeCollectionId(view) },
    status: restingOn(view, editing),
    ...problemAfterRender(view),
  };
}

/** The catalogue lists the diagram's collection at the revision it shows. */
export function diagramCurrent(
  collections: WorkspaceView['collections'],
  active: ActiveDiagram,
): boolean {
  return collections.some(
    (item) =>
      item.id === active.document.collection.id &&
      item.revision === active.document.collection.revision,
  );
}

/** The open collection is gone, already covered by the current request, unchanged, or reopened. */
function displayedRefresh(
  view: RefreshView,
  active: ActiveDiagram,
  rendering: RenderTicket | null,
): ActiveRefresh {
  const listed = view.collections.find((item) => item.id === active.document.collection.id);
  if (listed === undefined) return { kind: 'gone', active };
  if (refreshCovered(view, active, listed, rendering)) return { kind: 'none' };
  return { kind: 'reopen', id: active.document.collection.id };
}

/** The current request already renders the listed revision, or the shown scene has not moved. */
function refreshCovered(
  view: RefreshView,
  active: ActiveDiagram,
  listed: WorkspaceView['collections'][number],
  rendering: RenderTicket | null,
): boolean {
  return (
    requestCovers(rendering, listed, view.generation) ||
    !renderChanged(active, listed.revision, view.generation)
  );
}

/** The request renders this collection at its listed revision in the view's generation. */
function requestCovers(
  rendering: RenderTicket | null,
  listed: WorkspaceView['collections'][number],
  generation: ReadGeneration,
): boolean {
  return (
    rendering?.id === listed.id &&
    rendering.revision === listed.revision &&
    sameGeneration(rendering.generation, generation)
  );
}

/** The library rests on "Ready"; an open diagram on its editing status. */
function restingOn(
  view: Pick<WorkspaceView, 'active'>,
  editing: string,
): string {
  if (view.active === null) return 'Ready';
  return editing;
}
