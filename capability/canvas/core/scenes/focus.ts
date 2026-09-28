import type { FocusProjection, FocusSource, Emphasis } from '../../contract/records/focus.js';
import type { SessionState } from '../../contract/records/state.js';
import type { Target } from '../../contract/records/selection.js';
import { targetKey } from './address.js';

/** Sections and sequence items retain their existing selection behavior without invented graph focus. */
function graphTargets(targets: readonly Target[]): readonly Target[] {
  return targets.filter((target) => target.kind === 'node' || target.kind === 'wire');
}

/** Selection projects a neighborhood first; without one, hover previews it without muting the rest. */
function focusTargets(state: SessionState): {
  readonly source: FocusSource;
  readonly targets: readonly Target[];
} {
  const selected = graphTargets(state.selection);
  if (selected.length > 0) return { source: 'selection', targets: selected };
  const hovered = hoverTargets(state);
  if (hovered.length > 0) return { source: 'hover', targets: hovered };
  return { source: 'none', targets: [] };
}

/** Hover can identify a graph target without becoming a persisted selection. */
function hoverTargets(state: SessionState): readonly Target[] {
  if (state.hover === null) return [];
  return graphTargets([state.hover]);
}

/** A prior projection remains valid across camera-only state changes. */
function reusable(
  state: SessionState,
  previous: FocusProjection | undefined,
): boolean {
  if (!previous) return false;
  return [
    previous.inputs.scene === state.scene,
    previous.inputs.selection === state.selection,
    previous.inputs.hover === state.hover,
  ].every(Boolean);
}

/** A primary endpoint contributes its incident wire and the opposite scoped endpoint. */
function includeEndpoint(
  primary: ReadonlySet<string>,
  secondary: Set<string>,
  endpoint: string,
  opposite: string,
  wire: string,
): void {
  if (primary.has(endpoint)) secondary.add(opposite).add(wire);
}

/** A primary wire contributes endpoint nodes only; parallel wires remain independently addressable. */
function includeWire(
  primary: ReadonlySet<string>,
  secondary: Set<string>,
  wire: string,
  source: string,
  destination: string,
): void {
  if (primary.has(wire)) secondary.add(source).add(destination);
}

/** Derive the complete one-hop focus set in one pass over admitted wires. */
export function projectFocus(
  state: SessionState,
  previous?: FocusProjection,
): FocusProjection {
  if (reusable(state, previous) && previous) return previous;
  const focus = focusTargets(state);
  const primary = new Set(focus.targets.map(targetKey));
  const secondary = new Set<string>();
  state.scene.sections.forEach((section) =>
    section.wires.forEach((wire) => {
      const wireKey = targetKey({ kind: 'wire', section: section.id, id: wire.id });
      const sourceKey = targetKey({ kind: 'node', section: section.id, id: wire.source.node });
      const destinationKey = targetKey({ kind: 'node', section: section.id, id: wire.target.node });
      includeEndpoint(primary, secondary, sourceKey, destinationKey, wireKey);
      includeEndpoint(primary, secondary, destinationKey, sourceKey, wireKey);
      includeWire(primary, secondary, wireKey, sourceKey, destinationKey);
    }),
  );
  primary.forEach((key) => secondary.delete(key));
  return {
    source: focus.source,
    primary,
    secondary,
    inputs: { scene: state.scene, selection: state.selection, hover: state.hover },
  };
}

/** Focus presence maps every graph object to one paint role without changing true selection. */
export function emphasisFor(
  focus: FocusProjection,
  key: string,
): Emphasis {
  if (focus.source === 'none') return 'normal';
  if (focus.source === 'hover') return hoveredEmphasis(focus, key);
  return focusedEmphasis(focus, key);
}

/** Hover uses supporting paint throughout its neighborhood; primary paint and vignette require selection. */
function hoveredEmphasis(
  focus: FocusProjection,
  key: string,
): Emphasis {
  if (focus.primary.has(key) || focus.secondary.has(key)) return 'secondary';
  return 'normal';
}

/** Membership precedence ensures an explicit multi-selection never renders as its own neighbour. */
function focusedEmphasis(
  focus: FocusProjection,
  key: string,
): Emphasis {
  if (focus.primary.has(key)) return 'primary';
  if (focus.secondary.has(key)) return 'secondary';
  return 'muted';
}
