import type { Projection, VisualSection } from '../../contract/records/input.js';
import type { SceneCandidate, SectionCandidate } from '../../contract/records/candidate.js';
import type { PlacedSection, Box } from '../../contract/records/geometry.js';
import type { LayoutOptions, SupplementalMeasurements } from '../../contract/types.js';
import { inspectActivations } from './activations.js';
import { inspectNodes } from './nodes.js';
import { inspectWires } from './wires.js';
import { sequenceGeometry } from '../sequence/sequence.js';
import { contentBounds, titleBox, sectionBounds } from '../arrangement/bounds.js';
import { sectionKey } from '../arrangement/keys.js';
import { relativeSections } from '../constraints/relative.js';
import { contains, samePoint } from '../geometry/intersections.js';
import { union } from '../geometry/bounds.js';
import { same, sameIds, disjoint, equations } from './facts.js';
import { reject } from './outcomes.js';
import { inspectRouting } from './routing-overlay.js';
import { treeGeometry } from '../tree.js';
export interface InspectionContext {
  readonly options: LayoutOptions;
  readonly measurements: SupplementalMeasurements;
  readonly engines: readonly string[];
}
/** Fully rebind a candidate section from authoritative measured data after independent geometry checks. */
export function inspectSection(
  source: VisualSection,
  candidate: SectionCandidate,
  context: InspectionContext,
): PlacedSection {
  same(source.id, candidate.id, source.id);
  same(
    sectionKey(source, context.measurements, context.options, context.engines),
    candidate.inputKey,
    source.id,
  );
  const nodes = inspectNodes(source, candidate.nodes, context.options);
  const wires = inspectWires(source, candidate.wires, nodes, context.measurements, context.options);
  inspectActivations(source, candidate.sequence, nodes);
  const sequence = sequenceGeometry(source, nodes, context.measurements, context.options);
  same(sequence, candidate.sequence, source.id);
  const content = contentBounds(nodes, wires, sequence);
  const title = sectionTitle(source, content, context.options.padding);
  same(title, candidate.title, source.id);
  const bounds = sectionBounds(content, title.box, context.options.padding);
  if (source.envelope === undefined) checkBounds(bounds, candidate, source.placement);
  else checkEnvelope(source, candidate, content);
  checkLock(source, candidate);
  const tree = treeGeometry(source);
  same(tree, candidate.tree, source.id);
  return withTree(
    {
      routing: inspectRouting(source, candidate),
      id: source.id,
      origin: candidate.origin,
      box: candidate.box,
      title,
      inputKey: candidate.inputKey,
      nodes,
      wires,
      sequence,
    },
    tree,
  );
}
function sectionTitle(
  source: VisualSection,
  content: Box,
  padding: number,
): PlacedSection['title'] {
  if (source.envelope === undefined)
    return { content: source.title, box: titleBox(content, source.title, padding) };
  return {
    content: source.title,
    box: { x: padding, y: padding, width: source.title.width, height: source.title.height },
  };
}
function withTree(
  section: PlacedSection,
  tree: PlacedSection['tree'],
): PlacedSection {
  return tree === undefined ? section : { ...section, tree };
}
/** Collection-space bounds enclose all local geometry after applying the explicit origin exactly once. */
function checkBounds(
  local: Box,
  candidate: SectionCandidate,
  placement: VisualSection['placement'],
): void {
  const content = { ...local, x: local.x + candidate.origin.x, y: local.y + candidate.origin.y };
  if (!contains(candidate.box, content))
    reject('constraint-conflict', candidate.id, 'Section bounds omit visible content');
  const expected = {
    ...content,
    width: placement?.width ?? content.width,
    height: placement?.height ?? content.height,
  };
  if (!samePoint(expected, candidate.box))
    reject('constraint-conflict', candidate.id, 'Section origin differs from visible bounds');
}
/** A section lock fixes origin and only the optional dimensions that were actually authored. */
function checkLock(
  source: VisualSection,
  candidate: SectionCandidate,
): void {
  if (!source.placement?.locked) return;
  same({ x: source.placement.x, y: source.placement.y }, candidate.origin, source.id);
  supplied(source.placement.width, candidate.box.width, source.id);
  supplied(source.placement.height, candidate.box.height, source.id);
}
/** Omitted dimensions remain content-driven instead of accidentally becoming implicit locks. */
function supplied(
  expected: number | undefined,
  actual: number,
  id: string,
): void {
  if (expected === undefined) return;
  same(expected, actual, id);
}
/** Every source section appears once in declared reading order; no hidden scene fragments can escape validation. */
export function inspectSections(
  projection: Projection,
  candidate: SceneCandidate,
  context: InspectionContext,
): readonly PlacedSection[] {
  same(
    [projection.collectionId, projection.revision],
    [candidate.collectionId, candidate.revision],
    'scene',
  );
  same(context.engines, candidate.engineVersions, 'engines');
  const source = projection.sections.toSorted((a, b) => a.order - b.order);
  sameIds(
    source.map((section) => section.id),
    candidate.sections.map((section) => section.id),
    'sections',
  );
  same(
    source.map((section) => section.id),
    candidate.sections.map((section) => section.id),
    'section-order',
  );
  const sections = source.map((section) => requiredSection(section, candidate, context));
  disjoint(sections);
  equations(
    relativeSections(
      projection.arrangement,
      source.map((section) => section.id),
      context.options.gap[projection.arrangement.gap],
    ),
    sections,
  );
  same(union(sections.map((section) => section.box)), candidate.bounds, 'scene-bounds');
  return sections;
}
/** Required identity lookup rejects an omitted section before any content is reconstructed. */
function requiredSection(
  source: VisualSection,
  candidate: SceneCandidate,
  context: InspectionContext,
): PlacedSection {
  const found = candidate.sections.find((section) => section.id === source.id);
  if (!found) return reject('invalid-input', source.id, 'Candidate section is missing');
  return inspectSection(source, found, context);
}

/** Fixed app-owned envelope must contain all content; routing cannot silently grow it. */
function checkEnvelope(
  source: VisualSection,
  candidate: SectionCandidate,
  content: Box,
): void {
  const envelope = source.envelope;
  if (envelope === undefined) return;
  same([candidate.box.width, candidate.box.height], [envelope.width, envelope.height], source.id);
  const local = { x: 0, y: 0, width: envelope.width, height: envelope.height };
  if (!contains(local, content))
    reject('constraint-conflict', source.id, 'Content exceeds measured section envelope');
}
