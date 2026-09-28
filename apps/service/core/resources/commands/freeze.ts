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
import type { Json, Request, Snapshot } from '../../../contract/records/capability-types.js';
import type {
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/resource-commands.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import type { DslCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { hasDigestPrefix } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
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
  if (!request.success) return invalidInputFailure();
  return freezeRequest(request.data, snapshot, dependencies);
}

/** One theme alias and the exact pin it is frozen to. */
type FrozenPin = readonly [string, ThemePinText];

/** A DSL change is frozen (see `freezeDsl`); any other request is returned unchanged. */
function freezeRequest(
  request: Request,
  snapshot: Snapshot,
  dependencies: FreezeDependencies,
): ResourceResult<Request> {
  if (request.intent.kind !== 'change') return success(request);
  if (request.intent.planner !== 'dsl') return success(request);
  return freezeDsl(request, request.intent.payload, snapshot, dependencies);
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
  dependencies: FreezeDependencies,
): ResourceResult<Request> {
  const command = dslCommand.safeParse(payload);
  if (!command.success) return invalidInputFailure();
  const selected = dependencies.selector.select(request, snapshot);
  if (!selected.ok) return selected;
  const pins = collect(Object.entries(selected.value.resources.themes), frozenPin);
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
  if (!frozen.success) return invalidInputFailure();
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
  if (!hasDigestPrefix(theme.digest)) return resourceFailure(UNPINNED_THEME);
  return success(formatThemePin({ id: theme.id, version: theme.version, digest: theme.digest }));
}
