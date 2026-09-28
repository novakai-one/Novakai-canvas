/*
 * Why this file exists
 *
 * A DSL change can name a theme loosely, like `theme=paper`. The CLI keeps a change so it can send
 * it again later. If a newer `paper` were saved in between, the same change would quietly look
 * different. So before the CLI keeps it, each theme name is fixed to the exact version stored now,
 * such as `paper@1.1.0#sha256:…`. This is called freezing.
 *
 * This file freezes a DSL change's themes, using the selector's pick; any other change comes back
 * as it is. Each step answers a `Result` (contract/errors.ts). It never saves anything.
 */
import type {
  Json,
  Request,
  ResolvedResources,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import type { ResourceResult } from '../../../contract/records/presets/resource-commands.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import type { DslCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { hasDigestPrefix } from '../../../contract/brands.js';
import { collect, success } from '../../../contract/errors.js';
import type { ThemeBinding } from '../../presets/theme-binding.js';
import { formatThemePin, type ThemePinText } from '../../presets/theme-pin.js';
import { INPUT_RECOVERY, invalidInputFailure, resourceFailure } from './refusal.js';

/** What freezing needs. */
export interface FreezeDependencies {
  /** Picks the themes a request uses (selection/select.ts). */
  readonly selector: Pick<ResourceSelector, 'select'>;
}

/**
 * Fixes each theme a DSL change uses to its exact stored version, and answers the changed request.
 * `input` is the change request as sent; it is checked here. Any other change comes back as it
 * is. Fails with `invalid-input` at `resources` for a malformed request, or with the selector's
 * mistake.
 */
export function freezeThemeVersions(
  input: unknown,
  snapshot: Snapshot,
  dependencies: FreezeDependencies,
): ResourceResult<Request> {
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    return invalidInputFailure();
  }
  return freezeRequest(request.data, snapshot, dependencies);
}

/** One theme name and the exact pin it is frozen to. */
type FrozenPin = readonly [string, ThemePinText];

/** The themes the selector picked, keyed by the name the change uses. */
type SelectedThemes = ResolvedResources['themes'];

/** Freezes a DSL change's themes, and gives any other request back as it is. */
function freezeRequest(
  request: Request,
  snapshot: Snapshot,
  dependencies: FreezeDependencies,
): ResourceResult<Request> {
  if (request.intent.kind !== 'change') {
    return success(request);
  }
  if (request.intent.planner !== 'dsl') {
    return success(request);
  }
  return freezeDsl(request, request.intent.payload, snapshot, dependencies);
}

/** Checks the DSL payload, asks the selector which themes it uses, and pins each one. */
function freezeDsl(
  request: Request,
  payload: Json,
  snapshot: Snapshot,
  dependencies: FreezeDependencies,
): ResourceResult<Request> {
  const command = dslCommand.safeParse(payload);
  if (!command.success) {
    return invalidInputFailure();
  }
  const selected = dependencies.selector.select(request, snapshot);
  if (!selected.ok) {
    return selected;
  }
  return pinSelectedThemes(request, command.data, selected.value.resources.themes);
}

/** Freezes each selected theme to its exact pin, and writes the pins into the DSL change. */
function pinSelectedThemes(
  request: Request,
  command: DslCommand,
  selectedThemes: SelectedThemes,
): ResourceResult<Request> {
  const selectedEntries = Object.entries(selectedThemes);
  const pins = collect(selectedEntries, frozenPin);
  if (!pins.ok) {
    return pins;
  }
  return pinnedRequest(request, command, pins.value);
}

/** Freezes one selected theme to its exact pin, kept under the name the change uses. */
function frozenPin([alias, theme]: readonly [string, ThemeBinding]): ResourceResult<FrozenPin> {
  const pin = exactPin(theme);
  if (!pin.ok) {
    return pin;
  }
  const frozen: FrozenPin = [alias, pin.value];
  return success(frozen);
}

/** Replaces the DSL change's `themePins` with the frozen pins, and checks the request again. */
function pinnedRequest(
  request: Request,
  command: DslCommand,
  pins: readonly FrozenPin[],
): ResourceResult<Request> {
  const themePins = Object.fromEntries(pins);
  const payload = { ...command, themePins };
  const frozen = requestSchema.safeParse({ ...request, intent: { ...request.intent, payload } });
  if (!frozen.success) {
    return invalidInputFailure();
  }
  return success(frozen.data);
}

/** Writes one selected theme's exact pin, refusing a digest without Model's `sha256:` prefix. */
function exactPin(theme: ThemeBinding): ResourceResult<ThemePinText> {
  if (!hasDigestPrefix(theme.digest)) {
    return unpinnedThemeFailure();
  }
  const pin = formatThemePin({ id: theme.id, version: theme.version, digest: theme.digest });
  return success(pin);
}

/**
 * Makes the mistake for a selected theme whose digest lacks Model's `sha256:` prefix. Model checked
 * every binding the selector returns, so a selection never reaches it.
 */
function unpinnedThemeFailure(): ResourceResult<never> {
  return resourceFailure({
    code: 'invalid-input',
    path: 'themePins',
    message: 'Selected theme digest is not pinned',
    recovery: INPUT_RECOVERY,
  });
}
