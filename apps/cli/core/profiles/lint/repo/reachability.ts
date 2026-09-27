/*
 * Repo reachability rule of the build-spec profile: every shown repo object is reachable from the
 * declared root through the connected parent wires. Pure; the findings are returned.
 */
import type { ProfileFinding } from '../../../../contract/records/profiles.js';
import { field, id, reference, type Declaration } from '../declarations.js';
import { findingAt } from '../findings.js';

/** A parent edge: a wire's source and target object ids. */
type ParentEdge = {
  readonly source: string;
  readonly target: string;
};

/** Every shown object must be reachable from the root through parent wires. */
export function reachabilityFindings(
  section: Declaration,
  rootId: string | undefined,
  parentWires: readonly Declaration[],
  shownIds: ReadonlySet<string>,
): ProfileFinding[] {
  if (rootId === undefined) return [];
  const reachable = reachableObjects(rootId, childrenByParentOf(parentWires));
  return [...shownIds].flatMap((objectId) => unreachableFinding(section, objectId, reachable));
}

/** A shown object outside the reachable set is reported. */
function unreachableFinding(
  section: Declaration,
  objectId: string,
  reachable: ReadonlySet<string>,
): ProfileFinding[] {
  return reachable.has(objectId)
    ? []
    : [
        findingAt(section, {
          code: 'repo-unreachable',
          path: `section @repo show @${objectId}`,
          message:
            'Every shown repo object must be connected to the declared root by parent wires.',
        }),
      ];
}

/** The parent edges of the fully-specified wires. */
function childrenByParentOf(wires: readonly Declaration[]): ReadonlyMap<string, readonly string[]> {
  const edges = wires.flatMap((wire) => {
    const edge = parentEdge(wire);
    return edge === undefined ? [] : [edge];
  });
  return groupBySource(edges);
}

/** A wire's edge, when it carries an id, a source and a target. */
function parentEdge(wire: Declaration): ParentEdge | undefined {
  const wireId = id(wire);
  const source = reference(field(wire, 'source'))?.id;
  const target = reference(field(wire, 'target'))?.id;
  return wireId === undefined || source === undefined || target === undefined
    ? undefined
    : { source, target };
}

/** Targets grouped under their source. */
function groupBySource(edges: readonly ParentEdge[]): ReadonlyMap<string, readonly string[]> {
  const byParent = new Map<string, string[]>();
  for (const edge of edges) {
    byParent.set(edge.source, [...(byParent.get(edge.source) ?? []), edge.target]);
  }
  return byParent;
}

/** The objects reachable from the root, breadth-first over parent wires. */
function reachableObjects(
  rootId: string,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const reachable = new Set<string>([rootId]);
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) visitReachable(queue, reachable, childrenByParent);
  return reachable;
}

/** Dequeue one object; when new, mark it reachable and enqueue its children. */
function visitReachable(
  queue: string[],
  reachable: Set<string>,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): void {
  const current = queue.shift();
  if (current === undefined || reachable.has(current)) return;
  reachable.add(current);
  queue.push(...(childrenByParent.get(current) ?? []));
}
