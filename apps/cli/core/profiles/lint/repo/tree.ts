/*
 * Repo-section rules of the build-spec profile: exactly one shown root, parent wires with shown
 * endpoints, and every shown object reachable from the root through those wires. Each rule
 * returns its findings.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../../contract/records/profiles.js';
import {
  field,
  fieldFinding,
  findingAt,
  id,
  ids,
  reference,
  sectionById,
  shown,
  text,
  type Declaration,
} from '../declarations.js';

/** A parent edge: a wire's source and target object ids. */
type ParentEdge = {
  readonly source: string;
  readonly target: string;
};

/** Root, wire and reachability findings for the repo tree section. */
export function lintRepo(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const section = sectionById(indexed.sections, 'repo');
  if (section === undefined) return [];
  const roots = section.children.filter((child) => child.kind === 'root');
  const rootIds = rootIdsOf(roots);
  const shownIds = new Set(shown(section));
  const parentWires = repoParentWires(indexed, section);
  return [
    ...rootCountFinding(section, roots, rootIds),
    ...rootShownFinding(section, rootIds, shownIds),
    ...wirePresenceFinding(section, parentWires.length),
    ...parentWires.flatMap((wire) => repoWireFindings(wire, shownIds)),
    ...reachabilityFindings(section, rootIds[0], parentWires, shownIds),
  ];
}

/** The ids of the declared roots, skipping id-less roots. */
function rootIdsOf(roots: readonly Declaration[]): readonly string[] {
  return roots.flatMap((root) => {
    const rootId = id(root);
    return rootId === undefined ? [] : [rootId];
  });
}

/** The tree must declare exactly one root, and it must carry an id. */
function rootCountFinding(
  section: Declaration,
  roots: readonly Declaration[],
  rootIds: readonly string[],
): ProfileFinding[] {
  return roots.length !== 1 || rootIds.length !== 1
    ? [fieldFinding(section, 'id', 'section @repo', 'Tree section must declare one root.')]
    : [];
}

/** The declared root must be shown in the repo projection. */
function rootShownFinding(
  section: Declaration,
  rootIds: readonly string[],
  shownIds: ReadonlySet<string>,
): ProfileFinding[] {
  const rootId = rootIds[0];
  return rootId !== undefined && !shownIds.has(rootId)
    ? [
        findingAt(
          section,
          `section @repo root @${rootId}`,
          'Tree root must be shown in the repo projection.',
        ),
      ]
    : [];
}

/** The tree must connect at least one parent wire. */
function wirePresenceFinding(
  section: Declaration,
  count: number,
): ProfileFinding[] {
  return count === 0
    ? [findingAt(section, 'section @repo', 'Tree section must show and connect parent wires.')]
    : [];
}

/** The parent-kind wires whose ids the repo section connects. */
function repoParentWires(
  indexed: ProfileDeclarationIndex,
  section: Declaration,
): readonly Declaration[] {
  const connected = new Set(
    section.children
      .filter((child) => child.kind === 'connect')
      .flatMap((child) => ids(child, 'ids')),
  );
  return indexed.wires.filter(
    (wire) => text(wire, 'kind') === 'parent' && connected.has(id(wire) ?? ''),
  );
}

/** One wire's field and endpoint findings. */
function repoWireFindings(
  wire: Declaration,
  shownIds: ReadonlySet<string>,
): ProfileFinding[] {
  const wireId = id(wire);
  const source = reference(field(wire, 'source'))?.id;
  const target = reference(field(wire, 'target'))?.id;
  return [
    ...wireFieldsFinding(wire, wireId, source, target),
    ...wireEndpointsFinding(wire, wireId, source, target, shownIds),
  ];
}

/** A parent wire must reference a source and a target object. */
function wireFieldsFinding(
  wire: Declaration,
  wireId: string | undefined,
  source: string | undefined,
  target: string | undefined,
): ProfileFinding[] {
  return wireId !== undefined && source !== undefined && target !== undefined
    ? []
    : [
        findingAt(
          wire,
          `wire @${wireId ?? '?'}`,
          'Parent wire must have source and target objects.',
        ),
      ];
}

/** Both wire endpoints must be shown in the repo projection. */
function wireEndpointsFinding(
  wire: Declaration,
  wireId: string | undefined,
  source: string | undefined,
  target: string | undefined,
  shownIds: ReadonlySet<string>,
): ProfileFinding[] {
  return endpointHidden(source, target, shownIds)
    ? [
        findingAt(
          wire,
          `wire @${wireId ?? '?'}`,
          'Parent wire endpoints must be shown in the repo projection.',
        ),
      ]
    : [];
}

/** Both endpoints exist and at least one is not shown. */
function endpointHidden(
  source: string | undefined,
  target: string | undefined,
  shownIds: ReadonlySet<string>,
): boolean {
  return (
    source !== undefined && target !== undefined && (!shownIds.has(source) || !shownIds.has(target))
  );
}

/** Every shown object must be reachable from the root through parent wires. */
function reachabilityFindings(
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
        findingAt(
          section,
          `section @repo show @${objectId}`,
          'Every shown repo object must be connected to the declared root by parent wires.',
        ),
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
