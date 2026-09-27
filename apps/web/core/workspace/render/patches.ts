/*
 * The view changes around a render: a collection starts opening, a request fails or finishes, a
 * new session installs, or the existing session shows the newer document. A chooser request also
 * moves the collection switch. A panel-owned problem survives navigation; any other problem clears
 * on the next render attempt. Pure; the session publishes each patch.
 */
import type { Diagnostic } from '../../../contract/errors.js';
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../../contract/records/active-diagram.js';
import type { RenderTicket } from '../diagram/ticket.js';
import type { AdmittedRender } from '../diagram/admission.js';
import type { CollectionId } from '../../../contract/brands.js';

/** The fields the session publishes in one update. */
export type ViewPatch = Partial<WorkspaceView>;

/** The parts of the workspace view the render patches read. */
export type PatchView = Pick<WorkspaceView, 'active' | 'collections' | 'problem'>;

/** Opening starts: the target shows as opening; a chooser request also shows the switch loading. */
export function openingPatch(
  view: PatchView,
  ticket: RenderTicket,
): ViewPatch {
  if (ticket.mode === 'chooser') return chooserOpeningPatch(view, ticket.id);
  return { opening: ticket.id, status: 'Rendering diagram…', ...problemAfterRender(view) };
}

/** A failed request keeps the current diagram and shows why; a chooser failure also fails the switch. */
export function openFailurePatch(
  view: PatchView,
  ticket: RenderTicket,
  problem: Diagnostic,
): ViewPatch {
  if (ticket.mode === 'chooser') return chooserFailurePatch(view, ticket.id, problem);
  return { opening: null, problem, status: problem.message };
}

/** A finished request: nothing is opening and the switch rests on the open collection. */
export function openSuccessPatch(
  view: PatchView,
  status: string,
): ViewPatch {
  return {
    opening: null,
    collectionSwitch: { phase: 'idle', activeId: activeCollectionId(view) },
    status,
  };
}

/** A new session shows the document; the Add forms are those the opened collection keeps. */
export function installedPatch(
  view: PatchView,
  active: ActiveDiagram,
  status: string,
  creation: WorkspaceView['creation'],
): ViewPatch {
  return { active, status, creation, ...problemAfterRender(view) };
}

/** The existing session now shows the newer document, in the generation its snapshot was read in. */
export function reusedPatch(
  view: PatchView,
  active: ActiveDiagram,
  admitted: AdmittedRender,
  status: string,
): ViewPatch {
  return {
    opening: null,
    active: {
      ...active,
      generation: admitted.generation,
      document: admitted.document,
      base: admitted.base,
    },
    status,
    ...problemAfterRender(view),
  };
}

/** A render attempt clears the problem, unless it is a panel-preference failure. */
export function problemAfterRender(view: Pick<WorkspaceView, 'problem'>): ViewPatch {
  if (view.problem?.code === 'panel-preferences') return {};
  return { problem: null };
}

/** The open collection's ID; null in the library. */
export function activeCollectionId(view: Pick<WorkspaceView, 'active'>): CollectionId | null {
  return view.active?.document.collection.id ?? null;
}

/** A chooser request: the switch loads the target while the current diagram stays. */
function chooserOpeningPatch(
  view: PatchView,
  id: CollectionId,
): ViewPatch {
  return {
    opening: id,
    status: `Opening ${collectionTitle(view, id)}…`,
    collectionSwitch: { phase: 'loading', activeId: activeCollectionId(view), targetId: id },
    ...problemAfterRender(view),
  };
}

/** A failed chooser request: the switch fails on the target with the problem. */
function chooserFailurePatch(
  view: PatchView,
  id: CollectionId,
  problem: Diagnostic,
): ViewPatch {
  return {
    opening: null,
    problem,
    status: `Could not open ${collectionTitle(view, id)}`,
    collectionSwitch: {
      phase: 'failed',
      activeId: activeCollectionId(view),
      targetId: id,
      problem,
    },
  };
}

/** A collection's title in the catalogue, or "this collection" when it is not listed. */
function collectionTitle(
  view: PatchView,
  id: CollectionId,
): string {
  return view.collections.find((item) => item.id === id)?.title ?? 'this collection';
}
