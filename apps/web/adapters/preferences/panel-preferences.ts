/*
 * The panel-preference reader: checks a stored record's shape and parses its workspace with
 * Authoring's `workspaceId` schema. Pure; the panel store reports a refusal and keeps defaults.
 */
import { z } from 'zod';
import { workspaceId } from '@novakai/canvas-authoring';
import type { WorkspaceId } from '../../contract/brands.js';
import type { StoredPanelPreferences } from '../../contract/records/panels.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
const ids = z.array(z.string().min(1)).max(100);
const preferences = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: workspaceId,
  tabs: z
    .strictObject({ left: z.enum(['add', 'browse']), right: z.enum(['inspect', 'settings']) })
    .default({ left: 'browse', right: 'inspect' }),
  sections: z.strictObject({ left: ids, right: ids }),
  collapsed: ids,
  hidden: ids,
  widths: z.strictObject({
    left: z.number().finite().positive(),
    right: z.number().finite().positive(),
  }),
});
/**
 * Stored preferences for `workspace`, checked before registered-ID reconciliation. A bad shape or
 * workspace ID is `invalid-preferences`; a record for another workspace is `invalid-preferences`.
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
