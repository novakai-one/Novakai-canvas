/*
 * The panel layout readers: the shipped default layout and a workspace's stored preferences. Both
 * parse every section ID against `panelSectionIds`; the stored record's workspace is parsed with
 * Authoring's `workspaceId` schema. Pure. Startup refuses a bad default layout; the panel store
 * reports a refused stored record and keeps the defaults.
 */
import { z } from 'zod';
import { workspaceId } from '@novakai/canvas-authoring';
import type { WorkspaceId } from '../../contract/brands.js';
import { panelSectionIds } from '../../contract/brands.js';
import type { PanelDefaults, StoredPanelPreferences } from '../../contract/records/panels.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** Up to 100 side-panel section IDs, each one of `panelSectionIds`. */
const sectionIds = z.array(z.enum(panelSectionIds)).max(100);

/**
 * `resources/ui/panels.default.json`. `hiddenSectionIds` is checked but not used: every section
 * starts shown.
 */
const shippedDefaults = z.strictObject({
  schemaVersion: z.literal(1),
  panels: z.strictObject({
    left: z.strictObject({ sectionIds }),
    right: z.strictObject({ sectionIds }),
  }),
  collapsedSectionIds: sectionIds,
  hiddenSectionIds: sectionIds,
});

/** One workspace's stored panel preferences. A record without tabs gets the default tabs. */
const preferences = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: workspaceId,
  tabs: z
    .strictObject({ left: z.enum(['add', 'browse']), right: z.enum(['inspect', 'settings']) })
    .default({ left: 'browse', right: 'inspect' }),
  sections: z.strictObject({ left: sectionIds, right: sectionIds }),
  collapsed: sectionIds,
  hidden: sectionIds,
  widths: z.strictObject({
    left: z.number().finite().positive(),
    right: z.number().finite().positive(),
  }),
});

/**
 * The shipped default layout: each side's sections in order and the sections that start
 * collapsed. Fails with `initialization-failed` when the file is not a valid layout, including a
 * section ID that is not in `panelSectionIds`.
 */
export function readPanelDefaults(input: unknown): Result<PanelDefaults> {
  const checked = shippedDefaults.safeParse(input);
  if (!checked.success)
    return failure('initialization-failed', 'The shipped panel layout is invalid');
  const shipped = checked.data;
  const defaults: PanelDefaults = {
    sections: { left: shipped.panels.left.sectionIds, right: shipped.panels.right.sectionIds },
    collapsed: shipped.collapsedSectionIds,
  };
  return { ok: true, value: defaults };
}

/**
 * Stored preferences for `workspace`, checked before registered-ID reconciliation. A bad shape, a
 * section ID that is not in `panelSectionIds` or a bad workspace ID is `invalid-preferences`; a
 * record for another workspace is `invalid-preferences`.
 */
export function readPanelPreferences(
  input: unknown,
  workspace: WorkspaceId,
): Result<StoredPanelPreferences> {
  const checked = preferences.safeParse(input);
  if (!checked.success)
    return failure(
      'invalid-preferences',
      'Panel preferences were invalid; defaults remain available',
    );
  if (checked.data.workspace !== workspace)
    return failure('invalid-preferences', 'Panel preferences belong to another workspace');
  return { ok: true, value: checked.data };
}
