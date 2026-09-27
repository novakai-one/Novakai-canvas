/*
 * Panel layout rules: the mode for a viewport width, which side panels show, the default
 * preferences, the side each tab sits on, and each panel's width. Pure; nothing is stored here.
 * The panel store (`adapters/sessions/panel-session.ts`) holds the state and publishes it to React.
 */
import type {
  PanelId,
  PanelMode,
  PanelState,
  PanelPreferences,
  PanelSizing,
  PanelSectionDefinition,
  PanelTab,
} from '../../contract/records/panels.js';
import { sectionsOnSide } from '../panels/preferences.js';
/** Breakpoint thresholds are injected from Design System's resolved variables, matching CSS without another numeric authority. */
export function panelMode(
  width: number,
  sizing: Pick<PanelSizing, 'medium' | 'large'>,
): PanelMode {
  if (width >= sizing.large) return 'docked';
  return width >= sizing.medium ? 'overlay' : 'sheet';
}
/** Opening one transient panel replaces the prior overlay; desktop panels retain independent open state. */
export function openPanel(
  state: PanelState,
  side: PanelId,
  open: boolean,
): PanelState {
  if (state.mode === 'docked')
    return { ...state, docked: { ...state.docked, [side]: open }, lastOpened: side };
  return { ...state, overlay: open ? side : null, lastOpened: side };
}
/** Responsive changes retain layout and editor identity; only the most recently opened desktop pane becomes modal. */
export function resizePanels(
  state: PanelState,
  mode: PanelMode,
): PanelState {
  if (state.mode === mode) return state;
  return { ...state, mode, overlay: responsiveOverlay(state, mode) };
}
/** Initial narrow layout stays closed; transitioning from desktop establishes at most one modal panel. */
function responsiveOverlay(
  state: PanelState,
  mode: PanelMode,
): PanelId | null {
  if (mode === 'docked') return null;
  if (state.mode !== 'docked') return state.overlay;
  return lastDockedPanel(state);
}
/** Consumers ask one owner whether a side is visible, instead of storing duplicate inspector booleans. */
export function panelVisible(
  state: PanelState,
  side: PanelId,
): boolean {
  if (state.mode === 'docked') return state.docked[side];
  return state.overlay === side;
}
/** Defaults come from registered feature definitions and resolved dimensions. */
export function defaultPanels(
  workspace: string,
  definitions: readonly PanelSectionDefinition[],
  sizing: PanelSizing,
): PanelPreferences {
  return {
    schemaVersion: 1,
    tabs: { left: 'browse', right: 'inspect' },
    workspace,
    sections: {
      left: sectionsOnSide(definitions, 'left'),
      right: sectionsOnSide(definitions, 'right'),
    },
    collapsed: definitions.filter((item) => !item.defaultExpanded).map((item) => item.id),
    hidden: [],
    widths: { left: sizing.sides.left.width, right: sizing.sides.right.width },
  };
}

/** A closed last-used pane does not open itself during a responsive transition. */
function lastDockedPanel(state: PanelState): PanelId | null {
  if (!state.docked[state.lastOpened]) return null;
  return state.lastOpened;
}

/** Tab roles are shell-owned; features cannot migrate into a different semantic role. */
export function panelTabSide(tab: PanelTab): PanelId {
  const sides: Readonly<Record<PanelTab, PanelId>> = {
    add: 'left',
    browse: 'left',
    inspect: 'right',
    settings: 'right',
  };
  return sides[tab];
}
/** Effective widths share the viewport budget without overwriting retained preferred widths. */
export function panelGeometry(
  state: PanelState,
  sizing: PanelSizing,
  side: PanelId,
): { readonly width: number; readonly minimum: number; readonly maximum: number } {
  const bounds = sizing.sides[side];
  const other = side === 'left' ? 'right' : 'left';
  const reserve = visibleWidth(state, sizing, other);
  const minimumCanvas =
    sizing.canvasMinimum ?? sizing.large - sizing.sides.left.maximum - sizing.sides.right.maximum;
  const budget = Math.max(0, state.viewportWidth - minimumCanvas);
  const own = state.preferences.widths[side];
  const excess = Math.max(0, own + reserve - budget);
  const room = own - bounds.minimum;
  const otherRoom = Math.max(0, reserve - sizing.sides[other].minimum);
  const reduction = (excess * room) / Math.max(1, room + otherRoom);
  const width = Math.max(bounds.minimum, own - reduction);
  return {
    minimum: bounds.minimum,
    width,
    maximum: Math.max(
      bounds.minimum,
      Math.min(bounds.maximum, budget - reserve + excess - reduction),
    ),
  };
}
/** Closed panes reserve no canvas space. */
function visibleWidth(
  state: PanelState,
  sizing: PanelSizing,
  side: PanelId,
): number {
  if (!panelVisible(state, side)) return 0;
  return Math.max(sizing.sides[side].minimum, state.preferences.widths[side]);
}
