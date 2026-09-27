/*
 * Theme-pin freezing: a retained DSL request gets each theme alias replaced by the exact pin the
 * selector chose, so a later apply uses the same theme version. Pure over the selector; a refusal
 * throws PreparationFault or zod's error (`guarded` in refusal.ts turns both into a
 * ResourceResult), and Authoring owns the canonical write and receipt.
 */
import type { Request, Snapshot } from '../../../contract/records/capabilities.js';
import type { ResourceDiagnostic } from '../../../contract/records/presets/preparation.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { isPinnedDigest } from '../../../contract/brands.js';
import type { ThemeBinding } from '../../presets/theme-binding.js';
import { formatThemePin, type ThemePinText } from '../../presets/theme-pin.js';
import { PreparationFault, accepted } from './refusal.js';

/** The owner freezing selects through. */
export interface FreezeOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
}

/**
 * Retained DSL requests carry checked alias-to-exact-pin selections, including patch theme
 * changes; any other request is returned unchanged. Throws zod's error for a malformed request or
 * DSL payload, and PreparationFault with the selector's diagnostic when selection refuses, or
 * `invalid-input` at `themePins` when a selected theme's digest is not pinned.
 */
export function freeze(
  raw: unknown,
  snapshot: Snapshot,
  owners: FreezeOwners,
): Request {
  const request = requestSchema.parse(raw);
  if (request.intent.kind !== 'change') return request;
  if (request.intent.planner !== 'dsl') return request;
  const command = dslCommand.parse(request.intent.payload);
  const selected = accepted(owners.selector.select(request, snapshot));
  const themePins = Object.fromEntries(
    Object.entries(selected.resources.themes).map(([alias, theme]) => [alias, exactPin(theme)]),
  );
  return requestSchema.parse({
    ...request,
    intent: { ...request.intent, payload: { ...command, themePins } },
  });
}

/**
 * The refusal for a selected theme whose digest lacks Model's `sha256:` prefix. Model checked
 * every binding the selector returns, so a selection never reaches it.
 */
const UNPINNED_THEME: ResourceDiagnostic = Object.freeze({
  code: 'invalid-input',
  path: 'themePins',
  message: 'Selected theme digest is not pinned',
  recovery: 'Correct the named resource preparation input and prepare again.',
});

/**
 * The exact pin text of one selected theme. Throws PreparationFault (`invalid-input` at
 * `themePins`) when its digest is not in Model's pinned form.
 */
function exactPin(theme: ThemeBinding): ThemePinText {
  if (!isPinnedDigest(theme.digest)) throw new PreparationFault(UNPINNED_THEME);
  return formatThemePin({ id: theme.id, version: theme.version, digest: theme.digest });
}
