/*
 * Theme-pin freezing: a retained DSL request gets each theme alias replaced by the exact pin the
 * selector chose, so a later apply uses the same theme version. Pure over the selector; every
 * refusal is a returned value (refusal.ts), and Authoring owns the canonical write and receipt.
 */
import type { Json, Request, Snapshot } from '../../../contract/records/capabilities.js';
import type {
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/preparation.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import type { DslCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { isPinnedDigest } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import type { ThemeBinding } from '../../presets/theme-binding.js';
import { formatThemePin, type ThemePinText } from '../../presets/theme-pin.js';
import { INPUT_RECOVERY, invalidPreparation, preparationRefused } from './refusal.js';

/** The owner freezing selects through. */
export interface FreezeOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
}

/**
 * Retained DSL requests carry checked alias-to-exact-pin selections, including patch theme
 * changes; any other request is returned unchanged. Fails with `invalid-input` at `resources` for
 * a malformed request or DSL payload, with the selector's diagnostic when selection refuses, or
 * with `invalid-input` at `themePins` when a selected theme's digest is not pinned.
 */
export function freeze(
  raw: unknown,
  snapshot: Snapshot,
  owners: FreezeOwners,
): ResourceResult<Request> {
  const request = requestSchema.safeParse(raw);
  if (!request.success) return invalidPreparation();
  return freezeRequest(request.data, snapshot, owners);
}

/** One theme alias and the exact pin it is frozen to. */
type FrozenPin = readonly [string, ThemePinText];

/** A DSL change is frozen (see `freezeDsl`); any other request is returned unchanged. */
function freezeRequest(
  request: Request,
  snapshot: Snapshot,
  owners: FreezeOwners,
): ResourceResult<Request> {
  if (request.intent.kind !== 'change') return success(request);
  if (request.intent.planner !== 'dsl') return success(request);
  return freezeDsl(request, request.intent.payload, snapshot, owners);
}

/**
 * Selects the DSL request's resources, then writes each selected theme's exact pin into its
 * payload. Fails with `invalid-input` at `resources` for a malformed DSL payload, with the
 * selector's diagnostic, or as `exactPin` fails.
 */
function freezeDsl(
  request: Request,
  payload: Json,
  snapshot: Snapshot,
  owners: FreezeOwners,
): ResourceResult<Request> {
  const command = dslCommand.safeParse(payload);
  if (!command.success) return invalidPreparation();
  const selected = owners.selector.select(request, snapshot);
  if (!selected.ok) return selected;
  const pins = collect(Object.entries(selected.value.resources.themes).map(frozenPin));
  return andThen(pins, (frozen) => pinnedRequest(request, command.data, frozen));
}

/** One selected theme under its alias, frozen to its exact pin. Fails as `exactPin` fails. */
function frozenPin([alias, theme]: readonly [string, ThemeBinding]): ResourceResult<FrozenPin> {
  return andThen(exactPin(theme), (pin) => success([alias, pin] as const));
}

/**
 * The request with the DSL payload's `themePins` replaced by the frozen pins. Fails with
 * `invalid-input` at `resources` when the result is not a valid Authoring request.
 */
function pinnedRequest(
  request: Request,
  command: DslCommand,
  pins: readonly FrozenPin[],
): ResourceResult<Request> {
  const themePins = Object.fromEntries(pins);
  const frozen = requestSchema.safeParse({
    ...request,
    intent: { ...request.intent, payload: { ...command, themePins } },
  });
  if (!frozen.success) return invalidPreparation();
  return success(frozen.data);
}

/**
 * The refusal for a selected theme whose digest lacks Model's `sha256:` prefix. Model checked
 * every binding the selector returns, so a selection never reaches it.
 */
const UNPINNED_THEME: ResourceDiagnostic = Object.freeze({
  code: 'invalid-input',
  path: 'themePins',
  message: 'Selected theme digest is not pinned',
  recovery: INPUT_RECOVERY,
});

/**
 * The exact pin text of one selected theme. Fails with `invalid-input` at `themePins` when its
 * digest is not in Model's pinned form.
 */
function exactPin(theme: ThemeBinding): ResourceResult<ThemePinText> {
  if (!isPinnedDigest(theme.digest)) return preparationRefused(UNPINNED_THEME);
  return success(formatThemePin({ id: theme.id, version: theme.version, digest: theme.digest }));
}
