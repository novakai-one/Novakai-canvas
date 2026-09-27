import { z } from 'zod';
import type { PanelPreferences } from '../../contract/records/panels.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
const ids = z.array(z.string().min(1)).max(100);
const preferences = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: z.string(),
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
/** Stored preference shape and workspace are admitted before registered-ID reconciliation; invalid records are never applied. */
export function readPanelPreferences(
  input: unknown,
  workspace: string,
): Result<PanelPreferences> {
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
