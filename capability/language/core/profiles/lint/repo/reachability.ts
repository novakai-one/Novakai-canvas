/*
 * Repo reachability rule of the build-spec profile: every shown repo object is reachable from the
 * declared root through the connected parent wires. Pure; the findings are returned.
 */
import type { ProfileFinding } from '../../../../contract/records/profiles.js';
import { wireEnds, type Declaration } from '../declarations.js';
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
): readonly ProfileFinding[] {
  if (rootId === undefined) return [];
  const reachable = reachableFrom([rootId], new Set([rootId]), childrenByParentOf(parentWires));
  return [...shownIds].flatMap((objectId) => unreachableFinding(section, objectId, reachable));
}

/** A shown object outside the reachable set is reported. */
function unreachableFinding(
  section: Declaration,
  objectId: string,
  reachable: ReadonlySet<string>,
): readonly ProfileFinding[] {
  if (reachable.has(objectId)) return [];
  return [
    findingAt(section, {
      code: 'repo-unreachable',
      path: `section @repo show @${objectId}`,
      message: 'Every shown repo object must be connected to the declared root by parent wires.',
    }),
  ];
}

/** The children of each parent, in wire order, over the fully-specified wires. */
function childrenByParentOf(wires: readonly Declaration[]): ReadonlyMap<string, readonly string[]> {
  const edges = wires.flatMap(parentEdge);
  return new Map(edges.map((edge) => [edge.source, childrenOf(edge.source, edges)]));
}

/** The wire's edge as a one-item list; empty unless the wire has an id, a source and a target. */
function parentEdge(wire: Declaration): readonly ParentEdge[] {
  const ends = wireEnds(wire);
  if (ends.kind !== 'complete') return [];
  return [{ source: ends.source, target: ends.target }];
}

/** The targets of the edges leaving one parent. */
function childrenOf(
  parent: string,
  edges: readonly ParentEdge[],
): readonly string[] {
  return edges.filter((edge) => edge.source === parent).map((edge) => edge.target);
}

/**
 * Everything reachable over parent wires: `reached` plus the children of `frontier`, layer by
 * layer, until a layer adds nothing new.
 */
function reachableFrom(
  frontier: readonly string[],
  reached: ReadonlySet<string>,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const next = [
    ...new Set(frontier.flatMap((parent) => childrenByParent.get(parent) ?? [])),
  ].filter((child) => !reached.has(child));
  if (next.length === 0) return reached;
  return reachableFrom(next, new Set([...reached, ...next]), childrenByParent);
}
