/*
 * Repo tree rules of the build-spec profile: exactly one shown root, and parent wires that are
 * connected and have shown endpoints. Reachability from the root is checked in reachability.ts.
 * Pure; each rule returns its findings.
 */
import type { ObjectId } from '../../../../contract/brands.js';
import type { ProfileFinding, ProfilePath } from '../../../../contract/records/profiles.js';
import { buildSpecSlots } from '../../build-spec/descriptor.js';
import {
  connected,
  isConnectedWire,
  objectIdOf,
  sectionById,
  shown,
  text,
  wireEnds,
  type Declaration,
  type DeclarationIndex,
  type WireEnds,
} from '../declarations.js';
import { fieldFinding, findingAt } from '../findings.js';
import { reachabilityFindings } from './reachability.js';

/** Root, wire and reachability findings for the repo tree section. */
export function lintRepo(indexed: DeclarationIndex): readonly ProfileFinding[] {
  const section = sectionById(indexed.sections, buildSpecSlots.repo.id);
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

/** The object IDs of the declared roots, skipping ID-less roots. */
function rootIdsOf(roots: readonly Declaration[]): readonly ObjectId[] {
  return roots.flatMap((root) => {
    const rootId = objectIdOf(root);
    if (rootId === undefined) return [];
    return [rootId];
  });
}

/** The tree must declare exactly one root, and it must carry an id. */
function rootCountFinding(
  section: Declaration,
  roots: readonly Declaration[],
  rootIds: readonly ObjectId[],
): readonly ProfileFinding[] {
  if (roots.length === 1 && rootIds.length === 1) return [];
  return [
    fieldFinding(section, 'id', {
      code: 'repo-root',
      path: `section @${buildSpecSlots.repo.id}`,
      message: 'Tree section must declare one root.',
    }),
  ];
}

/** The declared root must be shown in the repo projection. */
function rootShownFinding(
  section: Declaration,
  rootIds: readonly ObjectId[],
  shownIds: ReadonlySet<ObjectId>,
): readonly ProfileFinding[] {
  const rootId = rootIds[0];
  if (rootId === undefined || shownIds.has(rootId)) return [];
  return [
    findingAt(section, {
      code: 'repo-root-hidden',
      path: `section @${buildSpecSlots.repo.id} root @${rootId}`,
      message: 'Tree root must be shown in the repo projection.',
    }),
  ];
}

/** The tree must connect at least one parent wire. */
function wirePresenceFinding(
  section: Declaration,
  count: number,
): readonly ProfileFinding[] {
  if (count > 0) return [];
  return [
    findingAt(section, {
      code: 'repo-wires',
      path: `section @${buildSpecSlots.repo.id}`,
      message: 'Tree section must show and connect parent wires.',
    }),
  ];
}

/** The parent-kind wires whose ids the repo section connects. */
function repoParentWires(
  indexed: DeclarationIndex,
  section: Declaration,
): readonly Declaration[] {
  const connectedIds = new Set(connected(section));
  return indexed.wires.filter(
    (wire) => text(wire, 'kind') === 'parent' && isConnectedWire(wire, connectedIds),
  );
}

/** One wire's field and endpoint findings. */
function repoWireFindings(
  wire: Declaration,
  shownIds: ReadonlySet<ObjectId>,
): readonly ProfileFinding[] {
  const ends = wireEnds(wire);
  return [...wireFieldsFinding(wire, ends), ...wireEndpointsFinding(wire, ends, shownIds)];
}

/** A parent wire must reference a source and a target object. */
function wireFieldsFinding(
  wire: Declaration,
  ends: WireEnds,
): readonly ProfileFinding[] {
  if (ends.kind === 'complete') return [];
  return [
    findingAt(wire, {
      code: 'repo-wire-endpoints',
      path: wireLabel(ends),
      message: 'Parent wire must have source and target objects.',
    }),
  ];
}

/** Both wire endpoints must be shown in the repo projection. */
function wireEndpointsFinding(
  wire: Declaration,
  ends: WireEnds,
  shownIds: ReadonlySet<ObjectId>,
): readonly ProfileFinding[] {
  if (!endpointHidden(ends, shownIds)) return [];
  return [
    findingAt(wire, {
      code: 'repo-wire-hidden',
      path: wireLabel(ends),
      message: 'Parent wire endpoints must be shown in the repo projection.',
    }),
  ];
}

/** The display path of a wire whose ID may be missing. */
function wireLabel(ends: WireEnds): ProfilePath {
  return `wire @${ends.id ?? '?'}`;
}

/** The wire has an id, a source and a target, and at least one endpoint is not shown. */
function endpointHidden(
  ends: WireEnds,
  shownIds: ReadonlySet<ObjectId>,
): boolean {
  return ends.kind === 'complete' && (!shownIds.has(ends.source) || !shownIds.has(ends.target));
}
