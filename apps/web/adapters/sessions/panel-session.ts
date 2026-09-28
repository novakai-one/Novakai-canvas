import type { PanelBindings, PanelController } from '../../contract/panel-types.js';
import type { WorkspaceId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import { diagnostic } from '../../contract/errors.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type {
  PanelState,
  PanelPreferences,
  PanelId,
  PanelTab,
  InterfaceControl,
  InterfaceVisibility,
} from '../../contract/records/panels.js';
import {
  defaultPanels,
  panelMode,
  openPanel,
  resizePanels,
  movePanelSection,
  panelMembership,
  panelWidth,
  panelGeometry,
  panelTabSide,
  reconcilePanelPreferences,
  storedPanels,
  unrestoredWorkspace,
  restoredWorkspace,
} from '../../contract/api.js';
/** This external store owns only panel presentation. Preference failures are reported; no operation changes a diagram or draft. */
export function createPanelController(bindings: PanelBindings): PanelController {
  let state: PanelState = {
    mode: panelMode(bindings.initialWidth, bindings.sizing),
    viewportWidth: bindings.initialWidth,
    docked: { left: false, right: false },
    overlay: null,
    lastOpened: 'left',
    customize: false,
    preferences: defaultPanels(bindings.definitions, bindings.sizing),
    interfaceVisibility: defaultInterfaceVisibility(),
  };
  let scope: WorkspaceScope = unrestoredWorkspace;
  let beforeHide: Omit<InterfaceVisibility, 'hidden'> | null = null;
  const listeners = new Set<() => void>();
  /** Stable snapshots allow React to subscribe without mirroring props into component state. */
  function publish(next: PanelState): void {
    state = next;
    listeners.forEach((listener) => listener());
  }
  /**
   * Persist only preference data; transient modal visibility is local to this session. Before a
   * workspace is restored, the layout changes on screen only.
   */
  function save(preferences: PanelPreferences): void {
    publish({ ...state, preferences });
    if (scope.phase === 'unrestored') return;
    const stored = storedPanels(preferences, scope.workspace);
    const saved = bindings.retention.write({ slot: 'panels', workspace: scope.workspace }, stored);
    if (!saved.ok) bindings.report(panelProblem(saved.error.message));
  }
  /** Workspace identity scopes personal panel preferences independently from diagram theme records. */
  function restore(workspace: WorkspaceId): void {
    scope = restoredWorkspace(workspace);
    publish({ ...state, preferences: defaultPanels(bindings.definitions, bindings.sizing) });
    const stored = bindings.retention.read({ slot: 'panels', workspace });
    if (!stored.ok) {
      bindings.report(panelProblem(stored.error.message));
      return;
    }
    if (stored.value !== null) restoreChecked(stored.value, workspace);
  }
  /** Known registrations decide applicability; persisted values can never inject React renderers. */
  function restoreChecked(
    input: unknown,
    workspace: WorkspaceId,
  ): void {
    const checked = bindings.read(input, workspace);
    if (!checked.ok) {
      bindings.report(panelProblem(checked.error.message));
      return;
    }
    const preferences = reconcilePanelPreferences(
      checked.value,
      bindings.definitions,
      bindings.sizing,
    );
    publish({ ...state, preferences });
    if (JSON.stringify(preferences.sections) !== JSON.stringify(checked.value.sections))
      bindings.report(panelProblem('Panel layout was updated for available features'));
  }
  /** Only trusted registered section IDs may change preference membership. */
  function membership(
    id: string,
    kind: 'collapsed' | 'hidden',
    present: boolean,
  ): void {
    if (!bindings.definitions.some((item) => item.id === id)) return;
    save({ ...state.preferences, [kind]: panelMembership(state.preferences[kind], id, present) });
  }
  /** Numeric layout inputs are bounded; invalid reorder indices cannot move or duplicate a section. */
  function move(
    id: string,
    side: PanelId,
    index: number,
  ): void {
    if (!Number.isInteger(index)) return;
    if (!bindings.definitions.some((item) => item.id === id && item.defaultSide === side)) return;
    save(movePanelSection(state.preferences, id, side, index));
  }
  /** Selecting a role retains the other panel's tab and all feature-owned drafts. */
  function selectTab(tab: PanelTab): void {
    const side = panelTabSide(tab);
    const tabs = { ...state.preferences.tabs, [side]: tab };
    save({ ...state.preferences, tabs });
    publish(openPanel(state, side, true));
  }
  return {
    selectTab,
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    open: (side, open) => publish(openPanel(state, side, open)),
    viewport: (width) =>
      publish(resizePanels({ ...state, viewportWidth: width }, panelMode(width, bindings.sizing))),
    resize: (side, width) =>
      save({
        ...state.preferences,
        widths: {
          ...state.preferences.widths,
          [side]: panelWidth(width, panelGeometry(state, bindings.sizing, side)),
        },
      }),
    expand: (id, expanded) => membership(id, 'collapsed', !expanded),
    hide: (id, hidden) => membership(id, 'hidden', hidden),
    move,
    customize: (customize) => publish({ ...state, customize }),
    reset: () => save(defaultPanels(bindings.definitions, bindings.sizing)),
    setInterfaceVisibility: (control: InterfaceControl, visible: boolean) => {
      if (state.interfaceVisibility.hidden) return;
      publish({
        ...state,
        interfaceVisibility: { ...state.interfaceVisibility, [control]: visible },
      });
    },
    hideInterface: () => {
      if (state.interfaceVisibility.hidden) return;
      beforeHide = {
        tools: state.interfaceVisibility.tools,
        zoom: state.interfaceVisibility.zoom,
        minimap: state.interfaceVisibility.minimap,
        outline: state.interfaceVisibility.outline,
        roads: state.interfaceVisibility.roads,
        labels: state.interfaceVisibility.labels,
      };
      publish({
        ...state,
        interfaceVisibility: {
          hidden: true,
          tools: false,
          zoom: false,
          minimap: false,
          outline: false,
          roads: false,
          // Labels are diagram content, not interface chrome: hiding the interface keeps them.
          labels: state.interfaceVisibility.labels,
        },
      });
    },
    revealInterface: () => {
      if (!state.interfaceVisibility.hidden) return;
      const restored = beforeHide ?? defaultInterfaceVisibility();
      beforeHide = null;
      publish({ ...state, interfaceVisibility: { hidden: false, ...restored } });
    },
  };
}

function defaultInterfaceVisibility(): InterfaceVisibility {
  return {
    hidden: false,
    tools: true,
    zoom: true,
    minimap: false,
    outline: true,
    roads: false,
    labels: false,
  };
}

/** A panel-layout failure. It stays shown across renders until dismissed (`problemAfterRender`). */
function panelProblem(message: string): Diagnostic {
  return diagnostic('panel-preferences', message, 'Customize or reset the panel layout.');
}
