/*
 * Panel state vocabulary: which side panels are open, their tabs, sizes and sections, the saved
 * panel preferences and which interface controls show. Records only: no behaviour, no I/O. Web
 * core reads them to lay out the shell; `panel-types.ts` names them in the panel controller.
 */

/** The two side panels. */
export type PanelId = 'left' | 'right';

/** How the panels sit beside the canvas at the current viewport width. */
export type PanelMode = 'docked' | 'overlay' | 'sheet';

/** The four panel tabs. */
export type PanelTab = 'add' | 'browse' | 'inspect' | 'settings';

/** An interface control a person can show or hide. */
export type InterfaceControl = 'tools' | 'zoom' | 'minimap' | 'outline' | 'roads' | 'labels';

/** Definitions describe trusted features; persisted layout contains only stable IDs and preferences. */
export interface PanelSectionDefinition {
  readonly id: string;
  readonly title: string;
  readonly defaultSide: PanelId;
  readonly defaultExpanded: boolean;
}

/** Breakpoints and per-side widths, resolved from the Design System's variables. */
export interface PanelSizing {
  readonly canvasMinimum?: number;
  readonly medium: number;
  readonly large: number;
  readonly sides: Readonly<
    Record<PanelId, { readonly width: number; readonly minimum: number; readonly maximum: number }>
  >;
}

/** Which interface controls show, and whether the whole interface is hidden. */
export interface InterfaceVisibility {
  readonly roads: boolean;
  readonly labels: boolean;
  readonly hidden: boolean;
  readonly tools: boolean;
  readonly zoom: boolean;
  readonly minimap: boolean;
  readonly outline: boolean;
}

/** Saved panel layout: section order and state, panel widths and each panel's tab. */
export interface PanelPreferences {
  readonly schemaVersion: 1;
  readonly workspace: string;
  readonly sections: Readonly<Record<PanelId, readonly string[]>>;
  readonly collapsed: readonly string[];
  readonly hidden: readonly string[];
  readonly widths: Readonly<Record<PanelId, number>>;
  readonly tabs: Readonly<{ left: 'add' | 'browse'; right: 'inspect' | 'settings' }>;
}

/** The web shell alone owns panel visibility. Canvas camera and editor draft data never enter this state. */
export interface PanelState {
  readonly mode: PanelMode;
  readonly viewportWidth: number;
  readonly docked: Readonly<Record<PanelId, boolean>>;
  readonly overlay: PanelId | null;
  readonly lastOpened: PanelId;
  readonly customize: boolean;
  readonly preferences: PanelPreferences;
  readonly interfaceVisibility: InterfaceVisibility;
}
