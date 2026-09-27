/*
 * Repo tree rules of the build-spec profile: exactly one shown root, and parent wires that are
 * connected and have shown endpoints. Reachability from the root is checked in reachability.ts.
 * Pure; each rule returns its findings.
 */
import type { ProfileFinding } from '../../../../contract/records/profiles.js';
import {
  field,
  id,
  ids,
  reference,
  sectionById,
  shown,
  text,
  type Declaration,
  type DeclarationIndex,
} from '../declarations.js';
import { fieldFinding, findingAt } from '../findings.js';
import { reachabilityFindings } from './reachability.js';

/** Root, wire and reachability findings for the repo tree section. */
export function lintRepo(indexed: DeclarationIndex): ProfileFinding[] {
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
    ? [
        fieldFinding(section, 'id', {
          code: 'repo-root',
          path: 'section @repo',
          message: 'Tree section must declare one root.',
        }),
      ]
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
        findingAt(section, {
          code: 'repo-root-hidden',
          path: `section @repo root @${rootId}`,
          message: 'Tree root must be shown in the repo projection.',
        }),
      ]
    : [];
}

/** The tree must connect at least one parent wire. */
function wirePresenceFinding(
  section: Declaration,
  count: number,
): ProfileFinding[] {
  return count === 0
    ? [
        findingAt(section, {
          code: 'repo-wires',
          path: 'section @repo',
          message: 'Tree section must show and connect parent wires.',
        }),
      ]
    : [];
}

/** The parent-kind wires whose ids the repo section connects. */
function repoParentWires(
  indexed: DeclarationIndex,
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
        findingAt(wire, {
          code: 'repo-wire-endpoints',
          path: `wire @${wireId ?? '?'}`,
          message: 'Parent wire must have source and target objects.',
        }),
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
        findingAt(wire, {
          code: 'repo-wire-hidden',
          path: `wire @${wireId ?? '?'}`,
          message: 'Parent wire endpoints must be shown in the repo projection.',
        }),
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
