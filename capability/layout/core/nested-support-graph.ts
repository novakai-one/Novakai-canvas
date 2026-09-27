import { collapseSupportEqualities } from './nested-support-equalities.js';
import type {
  NestedSupportConstraint,
  NestedSupportVertex,
} from '../contract/records/nested-support.js';
import type { NestedSupportFailure } from '../contract/records/nested-support-failure.js';

export interface Anchor {
  readonly key: string;
  readonly axis: 'x' | 'y';
  readonly position: number;
}
export interface Relation {
  readonly from: Anchor;
  readonly to: Anchor;
  readonly required: number;
  readonly kind: NestedSupportConstraint['kind'];
  readonly provenance: readonly string[];
}
export interface SupportGraph {
  readonly anchors: Map<string, Anchor>;
  readonly equalities: Map<string, string>;
  readonly relations: Relation[];
}

/** Private typed interruption; the public preflight owns conversion and callers own reconstruction. */
export class SupportRejection {
  constructor(readonly evidence: NestedSupportFailure) {}
}

/** Missing construction information is never replaced by an arbitrary coordinate or ordering. */
export function reject(
  reason: NestedSupportFailure['reason'],
  provenance: readonly string[],
  required: readonly number[] = [],
  available: readonly number[] = [],
): never {
  throw new SupportRejection({
    code: 'infeasible-embedding',
    reason,
    provenance,
    required,
    available,
  });
}

/** Absence is a typed contact failure; no substitute identity is invented. */
export function required<T>(
  index: ReadonlyMap<string, T>,
  key: string,
): T {
  const value = index.get(key);
  if (value === undefined) return reject('missing-contact', [key]);
  return value;
}

/** Invocation-local graph state; no positions are relaxed or materialized by Increment A. */
export function supportGraph(): SupportGraph {
  return { anchors: new Map(), equalities: new Map(), relations: [] };
}

/** Register a logical line once; repeated construction occurrences must agree. */
export function anchor(
  graph: SupportGraph,
  key: string,
  axis: Anchor['axis'],
  position: number,
): Anchor {
  if (!Number.isFinite(position)) reject('unsupported-support', [key], [], [position]);
  const prior = graph.anchors.get(key);
  if (prior !== undefined) return matching(prior, axis, position);
  const value = { key, axis, position };
  graph.anchors.set(key, value);
  return value;
}
function matching(
  prior: Anchor,
  axis: Anchor['axis'],
  position: number,
): Anchor {
  if (prior.axis !== axis || Math.abs(prior.position - position) > 0.0000001)
    reject('mismatched-contact', [prior.key], [prior.position], [position]);
  return prior;
}
function representative(
  graph: SupportGraph,
  key: string,
): string {
  const parent = graph.equalities.get(key);
  if (parent === undefined) return key;
  const root = representative(graph, parent);
  graph.equalities.set(key, root);
  return root;
}

/** Equalities arise only from shared construction lines, never proximity. */
export function equate(
  graph: SupportGraph,
  a: Anchor,
  b: Anchor,
): void {
  matching(a, b.axis, b.position);
  equateOffset(graph, a, b);
}

/** Preserve a measured port's offset while its body and driveway translate together. */
export function equateOffset(
  graph: SupportGraph,
  a: Anchor,
  b: Anchor,
): void {
  if (a.axis !== b.axis) reject('unsupported-support', [a.key, b.key]);
  const left = representative(graph, a.key),
    right = representative(graph, b.key);
  if (left !== right) graph.equalities.set(right, left);
}

/** Caller supplies retained structural orientation, including any deficient required separation. */
export function relate(
  graph: SupportGraph,
  from: Anchor,
  to: Anchor,
  required: number,
  kind: Relation['kind'],
  provenance: readonly string[],
): void {
  if (from.axis !== to.axis || !Number.isFinite(required))
    reject('unsupported-support', provenance);
  const minimum = kind === 'structure' ? Math.max(required, to.position - from.position) : required;
  graph.relations.push({ from, to, required: minimum, kind, provenance });
}
function vertices(graph: SupportGraph): readonly NestedSupportVertex[] {
  const groups = new Map<string, Anchor[]>();
  graph.anchors.forEach((a) => {
    const key = representative(graph, a.key);
    const group = groups.get(key) ?? [];
    group.push(a);
    groups.set(key, group);
  });
  return [...groups].map(([key, group]) => {
    const first = graph.anchors.get(key);
    if (first === undefined) return reject('unsupported-support', [key]);
    return {
      key,
      axis: first.axis,
      position: first.position,
      aliases: group.map((a) => a.key),
      aliasOffsets: Object.fromEntries(
        group.map((a) => [
          a.key,
          Math.abs(a.position - first.position) < 0.0000001 ? 0 : a.position - first.position,
        ]),
      ),
    };
  });
}
function constraint(
  graph: SupportGraph,
  relation: Relation,
  ordinal: number,
): NestedSupportConstraint {
  const from = representative(graph, relation.from.key),
    to = representative(graph, relation.to.key);
  const fromPosition = graph.anchors.get(from)?.position ?? relation.from.position;
  const toPosition = graph.anchors.get(to)?.position ?? relation.to.position;
  const required =
    relation.required + relation.from.position - fromPosition - relation.to.position + toPosition;
  const available = toPosition - fromPosition;
  return {
    key: `constraint:${ordinal}`,
    kind: relation.kind,
    from,
    to,
    required: Math.abs(required) < 0.0000001 ? 0 : required,
    available,
    deficit: Math.max(0, required - available),
    provenance: relation.provenance,
  };
}
function addEdge(
  index: Map<string, NestedSupportConstraint[]>,
  edge: NestedSupportConstraint,
): void {
  const list = index.get(edge.from) ?? [];
  list.push(edge);
  index.set(edge.from, list);
}
function admitEquality(edge: NestedSupportConstraint): boolean {
  if (edge.from !== edge.to) return false;
  if (edge.required > 0) reject('cyclic-constraints', edge.provenance, [edge.required], [0]);
  return true;
}
function edges(constraints: readonly NestedSupportConstraint[]) {
  return constraints.filter((edge) => !admitEquality(edge));
}
function release(
  edge: NestedSupportConstraint,
  incoming: Map<string, number>,
  queue: string[],
): void {
  const remaining = (incoming.get(edge.to) ?? 0) - 1;
  incoming.set(edge.to, remaining);
  if (remaining === 0) queue.push(edge.to);
}
function ordered(
  points: readonly NestedSupportVertex[],
  constraints: readonly NestedSupportConstraint[],
): readonly string[] {
  const incoming = new Map(points.map((point) => [point.key, 0]));
  const outgoing = new Map<string, NestedSupportConstraint[]>();
  edges(constraints).forEach((edge) => {
    addEdge(outgoing, edge);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  });
  const queue = points.filter((point) => incoming.get(point.key) === 0).map((point) => point.key);
  for (const key of queue)
    (outgoing.get(key) ?? []).forEach((edge) => release(edge, incoming, queue));
  if (queue.length !== points.length)
    reject(
      'cyclic-constraints',
      [...incoming].filter(([, count]) => count > 0).map(([key]) => key),
    );
  return queue;
}

/** Collapse construction equalities and admit the entire graph once; cycles are typed failures. */
export function admitSupportGraph(graph: SupportGraph) {
  const points = vertices(graph);
  const constraints = graph.relations.map((relation, ordinal) =>
    constraint(graph, relation, ordinal),
  );
  const collapsed = collapseSupportEqualities(points, constraints);
  return { ...collapsed, order: ordered(collapsed.vertices, collapsed.constraints) };
}
