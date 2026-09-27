/*
 * The view changes around a render: a collection starts opening, a request fails or finishes, a
 * new session installs, or the existing session shows the newer document. A chooser request also
 * moves the collection switch. A panel-owned problem survives navigation; any other problem clears
 * on the next render attempt. Pure; the session publishes each patch.
 */
import type { Diagnostic } from '../../../contract/errors.js';
import type { RenderDocument, Snapshot } from '../../../contract/records/owners.js';
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../../contract/records/active-diagram.js';
import type { RenderTicket } from './ticket.js';

/** The fields the session publishes in one update. */
export type ViewPatch = Partial<WorkspaceView>;

/** The parts of the workspace view the render patches read. */
export type PatchView = Pick<WorkspaceView, 'active' | 'collections' | 'problem' | 'generation'>;

/** A delivered document and the checked snapshot it installs against. */
export interface Installation {
  readonly document: RenderDocument;
  readonly base: Snapshot;
}

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

/** The existing session now shows the newer document at the view's generation. */
export function reusedPatch(
  view: PatchView,
  active: ActiveDiagram,
  installation: Installation,
  status: string,
): ViewPatch {
  return {
    opening: null,
    active: {
      ...active,
      generation: view.generation,
      document: installation.document,
      base: installation.base,
    },
    status,
    ...problemAfterRender(view),
  };
}

/** A render failure is the workspace's unless another owner already claimed it. */
export function ownedProblem(error: Diagnostic): Diagnostic {
  if (error.owner !== undefined) return error;
  return { ...error, owner: 'workspace' };
}

/** A render attempt clears the problem, unless the panel preferences own it. */
export function problemAfterRender(view: Pick<WorkspaceView, 'problem'>): ViewPatch {
  if (view.problem?.owner === 'panel-preferences') return {};
  return { problem: null };
}

/** The open collection's ID; null in the library. */
export function activeCollectionId(view: Pick<WorkspaceView, 'active'>): string | null {
  return view.active?.document.collection.id ?? null;
}

/** A chooser request: the switch loads the target while the current diagram stays. */
function chooserOpeningPatch(
  view: PatchView,
  id: string,
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
  id: string,
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
  id: string,
): string {
  return view.collections.find((item) => item.id === id)?.title ?? 'this collection';
}
