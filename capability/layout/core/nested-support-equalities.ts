import type {
  NestedSupportConstraint,
  NestedSupportVertex,
} from '../contract/records/nested-support.js';

interface Search {
  readonly outgoing: ReadonlyMap<string, readonly string[]>;
  readonly visited: Set<string>;
  readonly finish: string[];
}
function visit(
  search: Search,
  key: string,
): void {
  if (search.visited.has(key)) return;
  search.visited.add(key);
  (search.outgoing.get(key) ?? []).forEach((next) => visit(search, next));
  search.finish.push(key);
}
function append<K, V>(
  index: Map<K, V[]>,
  from: K,
  to: V,
): void {
  const group = index.get(from) ?? [];
  group.push(to);
  index.set(from, group);
}
function indexes(constraints: readonly NestedSupportConstraint[]) {
  const forward = new Map<string, string[]>(),
    reverse = new Map<string, string[]>();
  constraints
    .filter((edge) => edge.required === 0)
    .forEach((edge) => {
      append(forward, edge.from, edge.to);
      append(reverse, edge.to, edge.from);
    });
  return { forward, reverse };
}
function groups(
  points: readonly NestedSupportVertex[],
  constraints: readonly NestedSupportConstraint[],
) {
  const { forward, reverse } = indexes(constraints);
  const search: Search = { outgoing: forward, visited: new Set(), finish: [] };
  points.forEach((point) => visit(search, point.key));
  const visited = new Set<string>();
  return search.finish
    .toReversed()
    .map((key) => {
      const component: Search = { outgoing: reverse, visited, finish: [] };
      visit(component, key);
      return component.finish;
    })
    .filter((group) => group.length > 1);
}

function componentIndex(
  components: readonly (readonly string[])[],
  points: readonly NestedSupportVertex[],
  constraints: readonly NestedSupportConstraint[],
) {
  const membership = new Map(
    components.flatMap((group, ordinal) => group.map((key) => [key, ordinal] as const)),
  );
  const vertices = new Map<number, NestedSupportVertex[]>();
  const edges = new Map<number, NestedSupportConstraint[]>();
  points.forEach((point) => {
    const group = membership.get(point.key);
    if (group !== undefined) append(vertices, group, point);
  });
  constraints.forEach((edge) => collectEdge(edge, membership, edges));
  return { vertices, edges };
}
function collectEdge(
  edge: NestedSupportConstraint,
  membership: ReadonlyMap<string, number>,
  edges: Map<number, NestedSupportConstraint[]>,
): void {
  const group = membership.get(edge.from);
  if (group === undefined) return;
  if (group === membership.get(edge.to)) append(edges, group, edge);
}

/** Zero-separation strongly connected components force equality. Residual cycles remain rejected.
 * Pure reconstruction owns recovery; original constraint provenance and anchor floors survive.
 */
export function collapseSupportEqualities(
  points: readonly NestedSupportVertex[],
  constraints: readonly NestedSupportConstraint[],
) {
  const components = groups(points, constraints);
  const grouped = componentIndex(components, points, constraints);
  const byKey = new Map(points.map((point) => [point.key, point]));
  const representatives = new Map<string, string>();
  const resolutions = components.flatMap((members, ordinal) => {
    const originals = grouped.vertices.get(ordinal) ?? [];
    return originals.slice(0, 1).map((first) => {
      members.forEach((key) => representatives.set(key, first.key));
      const position = Math.max(...originals.map((point) => point.position));
      const edges = grouped.edges.get(ordinal) ?? [];
      byKey.set(first.key, {
        ...first,
        position,
        aliases: originals.flatMap((point) => point.aliases),
        aliasOffsets: Object.assign({}, ...originals.map((point) => point.aliasOffsets)),
      });
      return {
        members: originals,
        constraints: edges.map((edge) => edge.key),
        provenance: [...new Set(edges.flatMap((edge) => edge.provenance))],
        representative: first.key,
        position,
      };
    });
  });
  const retained = points.filter(
    (point) => (representatives.get(point.key) ?? point.key) === point.key,
  );
  return {
    vertices: retained.map((point) => byKey.get(point.key) ?? point),
    constraints: constraints.map((edge) => ({
      ...edge,
      from: representatives.get(edge.from) ?? edge.from,
      to: representatives.get(edge.to) ?? edge.to,
    })),
    equalities: resolutions,
  };
}
