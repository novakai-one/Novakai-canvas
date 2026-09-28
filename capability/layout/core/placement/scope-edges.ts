import type { VisualSection } from '../../contract/records/input.js';
import type { PlacementProblem } from '../../contract/records/problem.js';

/** Contract each wire to its immediate visible branches. Seeding and later spacing constraints must use this same ownership graph.
 * Validated acyclic groups enter here; pure replay performs no I/O. Layout owns rejection and Authoring retains the prior scene.
 */
export function scopeEdges(
  roots: readonly string[],
  section: VisualSection,
): PlacementProblem['edges'] {
  return section.wires.flatMap((wire): PlacementProblem['edges'] =>
    edge(wire.id, owner(wire.source.node, roots, section), owner(wire.target.node, roots, section)),
  );
}

/** Descendants inherit their nearest root in this scope; unrelated branches contribute no spacing. */
function owner(
  id: string,
  roots: readonly string[],
  section: VisualSection,
): string | null {
  if (roots.includes(id)) return id;
  const node = section.nodes.find((item): boolean => item.id === id);
  return parentOwner(node?.parent ?? null, roots, section);
}

/** Reaching the section boundary without finding a root means the endpoint is outside this scope. */
function parentOwner(
  parent: string | null,
  roots: readonly string[],
  section: VisualSection,
): string | null {
  if (parent === null) return null;
  return owner(parent, roots, section);
}

/** Missing endpoints and wires internal to one branch must not inflate the enclosing scope. */
function edge(
  id: string,
  source: string | null,
  target: string | null,
): PlacementProblem['edges'] {
  if (source === null || target === null || source === target) return [];
  return [{ id, source, target }];
}
