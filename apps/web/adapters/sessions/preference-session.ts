import type {
  Environment,
  UiPreferences,
  UiThemePin,
  ResolvedTokenSet,
  ScopeLease,
  TokenError,
} from '@novakai/canvas-design-system';
import type {
  PreferenceBindings,
  PreferenceController,
  PreferenceView,
  PreferenceInstallation,
} from '../../contract/records/preferences.js';
import type { Result, Diagnostic } from '../../contract/errors.js';
import { diagnostic } from '../../contract/errors.js';
import { designSystemFailure } from '../../contract/foreign-failures.js';
import { defaultPreferences } from '../../contract/api.js';
/** Start with a valid scope, then restore checked preferences. Rejection preserves stored evidence and a usable default session. */
export function createPreferenceController(
  bindings: PreferenceBindings,
): Result<PreferenceController> {
  const preferences = defaultPreferences();
  const resolved = resolve(bindings, preferences, bindings.environment);
  if (!resolved.ok) return resolved;
  const installed = bindings.installer.install(resolved.value);
  if (!installed.ok) return { ok: false, error: tokenFailure(installed.error) };
  return { ok: true, value: session(bindings, { lease: installed.value, preferences }) };
}
/** This store owns preference lifetime, never token policy. Failed writes remain visible; callers can retry or reset. */
function session(
  bindings: PreferenceBindings,
  installation: PreferenceInstallation,
): PreferenceController {
  let state: PreferenceView = { preferences: installation.preferences, problem: null };
  let lease = installation.lease;
  let environment = bindings.environment;
  const listeners = new Set<() => void>();
  /** Publish one immutable view so React never reconstructs snapshots while reading. */
  function publish(next: PreferenceView): void {
    state = next;
    listeners.forEach((listener) => listener());
  }
  /** A preference failure retains the last valid installed scope and identifies the recovery action. */
  function report(problem: Diagnostic): void {
    publish({ ...state, problem });
  }
  /** Read the owner's schema before resolving; no host casts or duplicated theme bounds are used. */
  function install(input: unknown): boolean {
    const checked = bindings.tokens.readPreferences(input);
    if (!checked.ok) {
      report(tokenFailure(checked.error));
      return false;
    }
    return installChecked(checked.value);
  }
  /** Scope replacement is atomic and preserves its original unmount baseline. */
  function installChecked(preferences: UiPreferences): boolean {
    const resolved = resolve(bindings, preferences, environment);
    if (!resolved.ok) {
      report(resolved.error);
      return false;
    }
    return installResolved(preferences, resolved.value);
  }
  /** A stale DOM lease is a visible failure; it cannot overwrite a newer theme owner. */
  function installResolved(
    preferences: UiPreferences,
    resolved: ResolvedTokenSet,
  ): boolean {
    const replaced = lease.replace(resolved);
    if (!replaced.ok) {
      report(tokenFailure(replaced.error));
      return false;
    }
    lease = replaced.value;
    publish({ preferences, problem: null });
    return true;
  }
  /** Save only admitted preferences. A storage failure leaves the selected theme usable for this session. */
  function change(preferences: UiPreferences): void {
    if (!install(preferences)) return;
    const saved = bindings.retention.write('ui-preferences', preferences);
    if (!saved.ok) report(storageFailure(saved.error));
  }
  /** Restore retains malformed or unknown records; recognized shipped-theme pins advance to the current release. */
  function restore(): void {
    const stored = bindings.retention.read('ui-preferences');
    if (!stored.ok) {
      report(storageFailure(stored.error));
      return;
    }
    admitStored(stored.value);
  }
  /** Admission stays separate from storage I/O so either failure keeps the active installation intact. */
  function admitStored(stored: unknown | null): void {
    if (stored === null) return;
    const checked = bindings.tokens.readPreferences(stored);
    if (!checked.ok) {
      report(tokenFailure(checked.error));
      return;
    }
    applyStored(checked.value);
  }
  /** An accepted browser choice may advance only to the current owner-issued pin with the same ID. */
  function applyStored(stored: UiPreferences): void {
    const current = currentTheme(stored, bindings.themes);
    if (!installChecked(current)) return;
    persistMigration(stored, current);
  }
  /** Persist release migration separately; the installed theme remains usable when storage is unavailable. */
  function persistMigration(
    stored: UiPreferences,
    current: UiPreferences,
  ): void {
    if (current === stored) return;
    const saved = bindings.retention.write('ui-preferences', current);
    if (!saved.ok) report(storageFailure(saved.error));
  }
  restore();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change,
    reset: () => change(defaultPreferences()),
    environment: (next) => {
      environment = next;
      install(state.preferences);
    },
    dispose: () => {
      listeners.clear();
      return released(lease);
    },
  };
}
/** A shipped UI release keeps the chosen theme ID while storing its new exact owner provenance. */
function currentTheme(
  preferences: UiPreferences,
  themes: PreferenceBindings['themes'],
): UiPreferences {
  if (preferences.theme.mode === 'system' || themes === undefined) return preferences;
  const pinned = preferences.theme.theme;
  const selected = themes.find((theme) => theme.id === pinned.id);
  if (!selected || samePin(selected, pinned)) return preferences;
  return { ...preferences, theme: { mode: 'pinned', theme: selected } };
}
/** Exact fields stay owner-issued; the host compares provenance but never constructs it. */
function samePin(
  left: UiThemePin,
  right: UiThemePin,
): boolean {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}
/** Owner validation controls system/pinned selection, contrast and all emitted CSS variables. */
function resolve(
  bindings: PreferenceBindings,
  preferences: UiPreferences,
  environment: Environment,
): Result<ResolvedTokenSet> {
  const result = bindings.tokens.resolve({
    scope: 'ui',
    sources: bindings.sources,
    preferences,
    environment,
  });
  if (!result.ok) return { ok: false, error: tokenFailure(result.error) };
  return result;
}
/** Recovery is local to preferences; changing a theme cannot require resending a diagram edit. */
const PREFERENCE_RECOVERY =
  'Choose an available theme or reset interface preferences. Stored diagram content is unchanged.';

/** A Design System refusal as the web's `ui-preferences` failure, keeping the refusal as its cause. */
function tokenFailure(error: TokenError): Diagnostic {
  return diagnostic(
    'ui-preferences',
    error.message,
    PREFERENCE_RECOVERY,
    designSystemFailure(error),
  );
}

/** Removes the installed scope; a refusal becomes {@link tokenFailure}. */
function released(lease: ScopeLease): Result<{ readonly restored: boolean }> {
  const cleaned = lease.cleanup();
  if (!cleaned.ok) return { ok: false, error: tokenFailure(cleaned.error) };
  return cleaned;
}

/** A browser storage failure, keeping its code, with the preference recovery text. */
function storageFailure(error: Diagnostic): Diagnostic {
  return { ...error, recovery: PREFERENCE_RECOVERY };
}
