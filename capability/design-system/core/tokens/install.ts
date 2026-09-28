import type {
  ScopeTarget,
  ScopeInstaller,
  ScopeLease,
  ScopeSnapshot,
} from '../../contract/ports/scope-target.js';
import type { Result } from '../../contract/errors.js';
import { protect, accepted, reject } from '../validation/outcomes.js';
import { validateResolved } from './scope.js';
/** Bind one scope target. Host owns lifecycle/retry; no installer-local state can overwrite newer generations. */
export function createInstaller(target: ScopeTarget): ScopeInstaller {
  return { install: (input) => protect(() => install(target, input)) };
}
/** Target replacement is atomic after all validation; cleanup captures the precise replaced snapshot. */
function install(
  target: ScopeTarget,
  input: unknown,
): ScopeLease {
  const scope = validateResolved(input);
  const before = accepted(target.read());
  const installed = accepted(target.replace(before.generation, scope.css));
  return lease(target, before, installed.generation);
}
/** Each immutable lease captures one generation. Replacement retains the initial baseline for eventual unmount. */
function lease(
  target: ScopeTarget,
  baseline: ScopeSnapshot,
  generation: number,
): ScopeLease {
  return {
    replace: (input) => protect(() => replace(target, baseline, generation, input)),
    cleanup: () => cleanup(target, baseline, generation),
  };
}
/** Validate before touching the DOM; a rejected preference leaves the currently installed scope intact. */
function replace(
  target: ScopeTarget,
  baseline: ScopeSnapshot,
  generation: number,
  input: unknown,
): ScopeLease {
  const scope = validateResolved(input);
  const current = accepted(target.read());
  if (current.generation !== generation)
    return reject(
      'provider-failure',
      'scope',
      'current lease',
      'Token scope belongs to a newer installation',
    );
  const installed = accepted(target.replace(generation, scope.css));
  return lease(target, baseline, installed.generation);
}
/** Stale cleanup is intentionally a no-op, including a newer installation of identical token values. */
function cleanup(
  target: ScopeTarget,
  before: ScopeSnapshot,
  installedGeneration: number,
): Result<{ readonly restored: boolean }> {
  return protect(() => {
    const current = accepted(target.read());
    if (current.generation !== installedGeneration) return { restored: false };
    accepted(target.replace(current.generation, before.variables));
    return { restored: true };
  });
}
