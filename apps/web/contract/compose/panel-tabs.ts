/*
 * The side panels' tabs: each tab's label, the scope line under it, and the text shown when all
 * of its sections are hidden. Data only; compose.ts hands it to the side panel.
 */
import type { PanelSlots } from '../../adapters/react/WorkspaceSidePanel.js';

/** The tabs of the left and right side panels, in display order. */
export const panelTabs: PanelSlots['tabs'] = Object.freeze({
  left: [
    {
      id: 'add',
      label: 'Add',
      scope: 'Create diagram content',
      empty: 'Creation tools are hidden. Customize panels to show them.',
    },
    {
      id: 'browse',
      label: 'Browse',
      scope: 'Shared collection',
      empty: 'All Browse sections are hidden. Customize to show them.',
    },
  ],
  right: [
    {
      id: 'inspect',
      label: 'Inspect',
      scope: 'Selected diagram content',
      empty: 'All Inspect sections are hidden. Customize to show them.',
    },
    {
      id: 'settings',
      label: 'Settings',
      scope: 'Personal to this browser',
      empty: 'Settings are hidden. Customize to show them.',
    },
  ],
});
