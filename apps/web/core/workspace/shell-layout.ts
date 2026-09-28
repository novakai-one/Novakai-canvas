/*
 * Which parts of the workspace shell show: the header, side panels, Source, problem bar, Recovery,
 * status bar and Reveal button, and the canvas chrome, roads and labels. A hidden interface keeps
 * only the canvas and the Reveal button. The React shell draws what this decides.
 */
import type { Diagnostic } from '../../contract/errors.js';
import type { InterfaceVisibility, PanelId, PanelState } from '../../contract/records/panels.js';
import type { WorkspaceView } from '../../contract/records/workspace.js';
import { panelVisible } from './panel-state.js';

/** The parts of the workspace view that decide the layout. */
export type LayoutView = Pick<
  WorkspaceView,
  'active' | 'opening' | 'sourceOpen' | 'problem' | 'collectionSwitch'
>;

/** The canvas controls the shell switches on or off. */
export type CanvasChrome = Pick<InterfaceVisibility, 'tools' | 'zoom' | 'minimap' | 'outline'>;

/** Which shell parts show, the problem the bar shows, and what the canvas draws. */
export interface ShellLayout {
  readonly header: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly source: boolean;
  /** The problem the bar shows; null shows no bar. */
  readonly problem: Diagnostic | null;
  readonly recovery: boolean;
  readonly status: boolean;
  readonly reveal: boolean;
  readonly chrome: CanvasChrome;
  readonly roads: boolean;
  readonly labels: boolean;
  /** The alerts sit above the zoom controls, which only an open diagram's canvas has. */
  readonly alertsAboveZoom: boolean;
}

/** Which shell parts show. Labels follow their own setting even while the interface is hidden. */
export function shellLayout(
  view: LayoutView,
  panels: PanelState,
): ShellLayout {
  const visibility = panels.interfaceVisibility;
  if (visibility.hidden) return hiddenLayout(visibility.labels);
  return shownLayout(view, panels);
}

/** A hidden interface turns every canvas control off; this one object is shared by every render. */
const hiddenChrome: CanvasChrome = { tools: false, zoom: false, minimap: false, outline: false };

/** A hidden interface: only the canvas and the Reveal button. Roads hide; labels keep their setting. */
function hiddenLayout(labels: boolean): ShellLayout {
  return {
    header: false,
    left: false,
    right: false,
    source: false,
    problem: null,
    recovery: false,
    status: false,
    reveal: true,
    chrome: hiddenChrome,
    roads: false,
    labels,
    alertsAboveZoom: false,
  };
}

/** A shown interface: each part follows its own setting and the open collection. */
function shownLayout(
  view: LayoutView,
  panels: PanelState,
): ShellLayout {
  const visibility = panels.interfaceVisibility;
  return {
    header: true,
    left: panelShown(panels, 'left', hasNavigation(view)),
    right: panelShown(panels, 'right', view.active !== null),
    source: view.sourceOpen,
    problem: settledProblem(view),
    recovery: true,
    status: true,
    reveal: false,
    chrome: canvasChrome(visibility),
    roads: visibility.roads,
    labels: visibility.labels,
    alertsAboveZoom: view.active !== null && visibility.zoom,
  };
}

/** A side panel shows when it is open and has something to show. */
function panelShown(
  panels: PanelState,
  side: PanelId,
  hasContent: boolean,
): boolean {
  return panelVisible(panels, side) && hasContent;
}

/** The left panel navigates a collection that is open or opening. */
function hasNavigation(view: LayoutView): boolean {
  return view.active !== null || view.opening !== null;
}

/** The problem bar waits while another collection is chosen or loads. */
function settledProblem(view: LayoutView): Diagnostic | null {
  return view.collectionSwitch.phase === 'idle' ? view.problem : null;
}

/** A shown interface's canvas controls, each from its own setting; built fresh each render. */
function canvasChrome(visibility: InterfaceVisibility): CanvasChrome {
  return {
    tools: visibility.tools,
    zoom: visibility.zoom,
    minimap: visibility.minimap,
    outline: visibility.outline,
  };
}
