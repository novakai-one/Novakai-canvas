/*
 * The panel layout readers: the shipped default layout and a workspace's stored preferences. Both
 * check every section ID against `panelSectionIds`; the stored record's workspace is parsed with
 * Authoring's `workspaceId` schema. Pure. Startup refuses a bad default layout and names where it
 * is wrong; a stored layout drops the IDs it no longer knows and keeps the rest; the panel store
 * reports a refused stored record and keeps the defaults.
 */
import { z } from 'zod';
import { workspaceId } from '@novakai/canvas-authoring';
import type { PanelSectionId, WorkspaceId } from '../../contract/brands.js';
import { panelSectionIds } from '../../contract/brands.js';
import type { PanelDefaults, StoredPanelPreferences } from '../../contract/records/panels.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** One side-panel section ID from `panelSectionIds`. */
const sectionId = z.enum(panelSectionIds);

/** Up to 100 section IDs in the shipped file, each one of `panelSectionIds`. */
const shippedSectionIds = z.array(sectionId).max(100);

/**
 * Up to 100 stored section IDs. An ID outside `panelSectionIds` is dropped, not refused, so a
 * layout saved before an ID was removed keeps the rest of its order and state.
 */
const storedSectionIds = z.array(z.string().min(1)).max(100).transform(keepKnownSections);

/**
 * `resources/ui/panels.default.json`. `hiddenSectionIds` is checked but not used: every section
 * starts shown.
 */
const shippedDefaults = z.strictObject({
  schemaVersion: z.literal(1),
  panels: z.strictObject({
    left: z.strictObject({ sectionIds: shippedSectionIds }),
    right: z.strictObject({ sectionIds: shippedSectionIds }),
  }),
  collapsedSectionIds: shippedSectionIds,
  hiddenSectionIds: shippedSectionIds,
});

/** One workspace's stored panel preferences. A record without tabs gets the default tabs. */
const preferences = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: workspaceId,
  tabs: z
    .strictObject({ left: z.enum(['add', 'browse']), right: z.enum(['inspect', 'settings']) })
    .default({ left: 'browse', right: 'inspect' }),
  sections: z.strictObject({ left: storedSectionIds, right: storedSectionIds }),
  collapsed: storedSectionIds,
  hidden: storedSectionIds,
  widths: z.strictObject({
    left: z.number().finite().positive(),
    right: z.number().finite().positive(),
  }),
});

/**
 * The shipped default layout: each side's sections in order and the sections that start
 * collapsed. Fails with `initialization-failed` when the file is not a valid layout, including a
 * section ID that is not in `panelSectionIds`; the message names the first wrong place.
 */
export function readPanelDefaults(input: unknown): Result<PanelDefaults> {
  const checked = shippedDefaults.safeParse(input);
  if (!checked.success)
    return failure('initialization-failed', describeShippedProblem(checked.error));
  const shipped = checked.data;
  const defaults: PanelDefaults = {
    sections: { left: shipped.panels.left.sectionIds, right: shipped.panels.right.sectionIds },
    collapsed: shipped.collapsedSectionIds,
  };
  return { ok: true, value: defaults };
}

/**
 * Stored preferences for `workspace`, checked before registered-ID reconciliation. A section ID
 * that is not in `panelSectionIds` is dropped. A bad shape or a bad workspace ID is
 * `invalid-preferences`; a record for another workspace is `invalid-preferences`.
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

/** The stored IDs that are in `panelSectionIds`, in stored order. */
function keepKnownSections(ids: readonly string[]): readonly PanelSectionId[] {
  return ids.filter(isPanelSectionId);
}

/** Whether a stored ID is one of `panelSectionIds`. */
function isPanelSectionId(id: string): id is PanelSectionId {
  return sectionId.safeParse(id).success;
}

/**
 * The first problem in the shipped file, with the place it is at, for example
 * `The shipped panel layout is invalid at panels.left.sectionIds.6: Invalid option: …`.
 * A problem with the whole file has no place.
 */
function describeShippedProblem(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return 'The shipped panel layout is invalid';
  const place = issue.path.map(String).join('.');
  if (place === '') return `The shipped panel layout is invalid: ${issue.message}`;
  return `The shipped panel layout is invalid at ${place}: ${issue.message}`;
}
