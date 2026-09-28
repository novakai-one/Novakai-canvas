/** Input decoding runs under Layout protect/execute; typed diagnostics tell callers to correct input and retry without changing committed state. */
import {
  arrangementRequest,
  routeRequest,
  inspectionRequest,
  keyRequest,
} from '../../contract/schemas.js';
import type { RawMeasurements } from '../../contract/schemas.js';
import type { ProjectionReader } from '../../contract/ports/projection.js';
import type { Projection, VisualNode, VisualSection } from '../../contract/records/input.js';
import type { SceneCandidate } from '../../contract/records/candidate.js';
import type {
  LayoutRequest,
  SupplementalMeasurements,
  RouteRequest,
  InspectionRequest,
} from '../../contract/types.js';
import { box } from '../../contract/records/geometry.js';
import { PROJECTION_CAPACITY } from '../../contract/records/limits.js';
import { parse, requireValue, reject, snapshot } from './outcomes.js';
import { checkColumns } from './columns.js';
export type CheckedLayoutRequest = Omit<LayoutRequest, 'previous'> & {
  readonly previous: SceneCandidate | null;
};
export type CheckedRouteRequest = Omit<RouteRequest, 'fixed'> & { readonly fixed: SceneCandidate };
export type CheckedInspectionRequest = Omit<InspectionRequest, 'candidate'> & {
  readonly candidate: SceneCandidate;
};
/** Duplicate identities never reach solvers whose maps would silently overwrite one member. */
function unique(
  ids: readonly string[],
  path: string,
): void {
  if (new Set(ids).size !== ids.length)
    reject('invalid-input', path, 'Duplicate geometry identity', ids);
}
/** Validate consumed geometry after the owner decodes its full measured vocabulary. */
function projection(
  input: unknown,
  reader: ProjectionReader,
): Projection {
  const result = requireValue(reader.read(input));
  unique(
    result.sections.map((item) => item.id),
    'sections',
  );
  result.sections.forEach(checkSection);
  checkLimits(result);
  requireValue(checkColumns(result));
  return result;
}
/** The scale bound is explicit rather than relying on an engine allocation failure. */
function checkLimits(projection: Projection): void {
  const nodes = projection.sections.reduce((sum, section) => sum + section.nodes.length, 0);
  const wires = projection.sections.reduce((sum, section) => sum + section.wires.length, 0);
  if (
    nodes > PROJECTION_CAPACITY.maxNodes ||
    wires > PROJECTION_CAPACITY.maxWires ||
    projection.sections.length > PROJECTION_CAPACITY.maxSections
  )
    reject(
      'limit',
      'projection',
      `Layout limit is ${PROJECTION_CAPACITY.maxSections} sections / ${PROJECTION_CAPACITY.maxNodes} nodes / ${PROJECTION_CAPACITY.maxWires} wires`,
    );
}
/** Every local parent and wire endpoint is checked even if no native engine is called for cached data. */
function checkSection(section: VisualSection): void {
  unique(
    section.nodes.map((node) => node.id),
    section.id,
  );
  unique(
    section.wires.map((wire) => wire.id),
    section.id,
  );
  section.nodes.forEach((node) => checkNode(node, section));
  section.wires.forEach((wire) => {
    checkEndpoint(wire.source, section);
    checkEndpoint(wire.target, section);
  });
}
/** Measured sizes are finite minimum bounds; ancestors must resolve without cycles in the same scope. */
function checkNode(
  node: VisualNode,
  section: VisualSection,
): void {
  parse(box, { x: 0, y: 0, width: node.width, height: node.height });
  if (node.sectionId !== section.id)
    reject('invalid-input', node.id, 'Node section does not match its scope');
  checkParents(node, section, []);
}
/** A bounded immutable ancestor path makes cycle diagnostics explicit rather than recursing indefinitely. */
function checkParents(
  node: VisualNode,
  section: VisualSection,
  path: readonly string[],
): void {
  if (node.parent === null) return;
  if (path.includes(node.id))
    reject('invalid-input', node.id, 'Group parent cycle', [...path, node.id]);
  const parent = requiredNode(node.parent, section);
  checkParents(parent, section, [...path, node.id]);
}
/** Required local node lookup rejects a missing reference at the consumer boundary. */
function requiredNode(
  id: string,
  section: VisualSection,
): VisualNode {
  const found = section.nodes.find((node) => node.id === id);
  if (!found) return reject('invalid-input', id, 'Referenced visible node is missing');
  return found;
}
/** Row endpoints cannot silently attach to the whole object when their member disappeared. */
function checkEndpoint(
  endpoint: VisualSection['wires'][number]['source'],
  section: VisualSection,
): void {
  const node = requiredNode(endpoint.node, section);
  if (endpoint.member === null) return;
  if (!node.content.anchors.some((anchor) => anchor.member === endpoint.member))
    reject('invalid-input', node.id, 'Referenced measured member anchor is missing');
}
/** Presentation owns heading content shape; Layout requires exactly the fragment/branch address set. */
function supplemental(
  raw: RawMeasurements,
  projection: Projection,
  reader: ProjectionReader,
): SupplementalMeasurements {
  const headings = raw.branchHeadings.map((item) => ({
    ...item,
    content: requireValue(reader.content(item.content)),
  }));
  const expected = projection.sections.flatMap((section) =>
    section.sequence.flatMap((item) => branchKeys(section.id, item.item)),
  );
  const actual = headings.map((item) => key(item.section, item.fragment, item.branch));
  unique(actual, 'branchHeadings');
  if (JSON.stringify([...expected].toSorted()) !== JSON.stringify([...actual].toSorted()))
    reject('invalid-input', 'branchHeadings', 'Measured branch headings do not match the sequence');
  return { ...raw, branchHeadings: headings };
}
/** Alternative branches have their own headings; non-fragment items contribute none. */
function branchKeys(
  section: string,
  item: VisualSection['sequence'][number]['item'],
): readonly string[] {
  if (item.kind === 'event') return [];
  return item.branches.map((branch) => key(section, item.id, branch.id));
}
/** Namespaced tuple encoding avoids collisions between author-controlled string identities. */
function key(
  section: string,
  fragment: string,
  branch: string,
): string {
  return JSON.stringify([section, fragment, branch]);
}
/** Snapshot and check arrangement inputs; public execute returns any structured failure to Authoring. */
export function readArrangement(
  input: unknown,
  reader: ProjectionReader,
): CheckedLayoutRequest {
  const raw = parse(arrangementRequest, snapshot(input));
  const source = projection(raw.projection, reader);
  return {
    ...raw,
    projection: source,
    measurements: supplemental(raw.measurements, source, reader),
  };
}
/** Route-only requires fixed geometry, never an optional previous-scene hint. */
export function readRoute(
  input: unknown,
  reader: ProjectionReader,
): CheckedRouteRequest {
  const raw = parse(routeRequest, snapshot(input));
  const source = projection(raw.projection, reader);
  return {
    ...raw,
    projection: source,
    measurements: supplemental(raw.measurements, source, reader),
  };
}
/** Inspection always pairs candidate geometry with authoritative measured intent/options. */
export function readInspection(
  input: unknown,
  reader: ProjectionReader,
): CheckedInspectionRequest {
  const raw = parse(inspectionRequest, snapshot(input));
  const source = projection(raw.projection, reader);
  return {
    ...raw,
    projection: source,
    measurements: supplemental(raw.measurements, source, reader),
  };
}

/** Decode the same measured inputs for a host to obtain an exact full derivation/job key. */
export function readKey(
  input: unknown,
  reader: ProjectionReader,
): Omit<CheckedLayoutRequest, 'job'> {
  const raw = parse(keyRequest, snapshot(input));
  const source = projection(raw.projection, reader);
  return {
    ...raw,
    projection: source,
    measurements: supplemental(raw.measurements, source, reader),
  };
}
