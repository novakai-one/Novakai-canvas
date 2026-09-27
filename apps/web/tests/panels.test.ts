import { it, expect } from 'vitest';
import { createPanelController } from '../adapters/sessions/panel-session.js';
import { readPanelPreferences } from '../adapters/preferences/panel-preferences.js';
import { panelVisible, reconcilePanelPreferences } from '../contract/index.js';
import type { PanelSectionDefinition, PanelSizing } from '../contract/panel-types.js';
import { memoryRetention } from './recovery-fixtures.js';
import { verifyPreferenceRecovery } from './preference-recovery.js';

/** Frozen host case 6 checks state ownership; visible modal focus/scroll still requires the independent browser audit. */
it('host 6 preserves panel order, collapsed sections and separate drafts across responsive transitions', async () => {
  const definitions: readonly PanelSectionDefinition[] = [
    { id: 'collections', title: 'Collections', defaultSide: 'left', defaultExpanded: true },
    { id: 'sections', title: 'Diagrams', defaultSide: 'left', defaultExpanded: false },
    { id: 'content', title: 'Content', defaultSide: 'right', defaultExpanded: true },
  ];
  const sizing: PanelSizing = {
    medium: 800,
    large: 1200,
    sides: {
      left: { width: 248, minimum: 208, maximum: 360 },
      right: { width: 320, minimum: 280, maximum: 420 },
    },
  };
  const retention = memoryRetention();
  const source = { source: 'unapplied source', base: 7 };
  retention.write('source-draft.demo', source);
  const notices: string[] = [];
  const bindings = {
    definitions,
    sizing,
    initialWidth: 1440,
    retention,
    read: readPanelPreferences,
    report: (message: string) => {
      notices.push(message);
    },
  };
  const panels = createPanelController(bindings);
  panels.restore('demo');
  expect(panelVisible(panels.getSnapshot(), 'left')).toBe(false); // panels start closed
  expect(panelVisible(panels.getSnapshot(), 'right')).toBe(false);
  panels.open('left', true);
  panels.open('right', true);
  expect(panelVisible(panels.getSnapshot(), 'left')).toBe(true);
  expect(panelVisible(panels.getSnapshot(), 'right')).toBe(true);
  panels.expand('content', false);
  panels.move('content', 'left', 0); // a section never leaves its role's side
  expect(panels.getSnapshot().preferences.sections).toEqual({
    left: ['collections', 'sections'],
    right: ['content'],
  });
  panels.move('sections', 'left', 0);
  panels.move('sections', 'left', 0); // repeated placement is idempotent
  expect(panels.getSnapshot().preferences.sections).toEqual({
    left: ['sections', 'collections'],
    right: ['content'],
  });
  expect(panels.getSnapshot().preferences.collapsed).toContain('content');
  panels.viewport(1000);
  expect(panels.getSnapshot()).toMatchObject({ mode: 'overlay', overlay: 'right' });
  panels.open('left', true);
  expect(panelVisible(panels.getSnapshot(), 'right')).toBe(false);
  expect(panelVisible(panels.getSnapshot(), 'left')).toBe(true);
  panels.viewport(600);
  expect(panels.getSnapshot()).toMatchObject({ mode: 'sheet', overlay: 'left' });
  panels.open('left', false);
  expect(panels.getSnapshot().overlay).toBeNull();
  panels.viewport(1440);
  expect(panels.getSnapshot().mode).toBe('docked');
  panels.resize('left', 10000);
  expect(panels.getSnapshot().preferences.widths.left).toBe(360);
  panels.hide('content', true);
  const retained = panels.getSnapshot().preferences;
  const reopened = createPanelController({ ...bindings, initialWidth: 600 });
  reopened.restore('demo');
  expect(reopened.getSnapshot().preferences).toEqual(retained);
  expect(reopened.getSnapshot().overlay).toBeNull(); // a reload does not unexpectedly open a modal
  expect(retention.read('source-draft.demo')).toEqual({ ok: true, value: source });
  const nextDefinitions = [
    ...definitions,
    { id: 'history', title: 'History', defaultSide: 'right' as const, defaultExpanded: false },
  ];
  const reconciled = reconcilePanelPreferences(
    {
      ...retained,
      sections: { left: ['content', 'obsolete', 'content'], right: ['content', 'collections'] },
    },
    nextDefinitions,
    sizing,
  );
  // Saved sections return to their role's side; duplicates and unknown IDs drop; new ones join their default side.
  expect(reconciled.sections).toEqual({
    left: ['collections', 'sections'],
    right: ['content', 'history'],
  });
  expect(reconciled.collapsed).toContain('history');
  reopened.reset();
  expect(reopened.getSnapshot().preferences.sections).toEqual({
    left: ['collections', 'sections'],
    right: ['content'],
  });
  expect(retention.read('source-draft.demo')).toEqual({ ok: true, value: source });
  expect(notices).toEqual([]);
  await verifyPreferenceRecovery(retention);
});
