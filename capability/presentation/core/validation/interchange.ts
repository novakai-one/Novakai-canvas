import type { DomainReader } from '../../contract/ports/domain.js';
import type { InputCollection, Section } from '../../contract/records/input.js';
import type {
  Projection,
  VisualNode,
  VisualSection,
  VisualWire,
} from '../../contract/records/visual.js';
import { projectionEnvelope } from '../../contract/records/interchange.js';
import type { SectionEnvelope, WireEnvelope } from '../../contract/records/interchange.js';
import { clone, parse, reject, requireValue } from './outcomes.js';
import { requireProjectionCapacity } from './capacity.js';
/** Property order is not domain meaning; array order remains significant in a transported projection. */
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  return normalizedRecord(value);
}
/** Only plain serialized values reach this comparison; no provider or browser objects are inspected. */
function normalizedRecord(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalized(item)]),
  );
}
/** Reject altered domain fragments before reconstructing trusted records; caller retains its current scene. */
function equal(
  expected: unknown,
  actual: unknown,
  path: string,
): void {
  if (JSON.stringify(normalized(expected)) !== JSON.stringify(normalized(actual)))
    reject('invalid-input', path, 'Serialized projection does not match its canonical collection');
}
/** Required owner identity lookup never substitutes a similarly named record. */
function required<T>(
  value: T | undefined,
  path: string,
): T {
  if (value === undefined)
    return reject('invalid-input', path, 'Projection references a missing canonical record');
  return value;
}
/** Foreign relationship kind and routing are copied only from the validated collection. */
function readWire(
  raw: WireEnvelope,
  section: Section,
  collection: InputCollection,
): VisualWire {
  const relationship = required(
    collection.relationships.find((item) => item.id === raw.relationshipId),
    raw.id,
  );
  const route = required(
    section.wires.find((item) => item.relationship === raw.relationshipId),
    raw.id,
  );
  equal([section.id, relationship.kind, route], [raw.sectionId, raw.kind, raw.route], raw.id);
  return { ...raw, kind: relationship.kind, route };
}
/** Canonical kind selects semantic admission even when an explicit frame projects a generic card shape. */
function readNode(
  raw: VisualNode,
  collection: InputCollection,
): VisualNode {
  if (raw.objectId === null) return raw;
  const source = required(
    collection.objects.find((item) => item.id === raw.objectId),
    raw.id,
  );
  if (['module', 'entity', 'function', 'interface'].includes(source.kind)) requireLodRoles(raw);
  return { ...raw, kind: source.kind };
}

/** Admitted semantic nodes must carry explicit role metadata; transport readers never infer it. */
function requireLodRoles(node: VisualNode): void {
  if (node.content.primitives.some((primitive) => primitive.lodRole === undefined))
    reject('invalid-input', node.id, 'Engineering node primitive is missing its semantic LOD role');
}
/** Section intent and sequence semantics belong to Model; visual measurements retain their checked shapes. */
function readSection(
  raw: SectionEnvelope,
  collection: InputCollection,
): VisualSection {
  const source = required(
    collection.sections.find((item) => item.id === raw.id),
    raw.id,
  );
  equal(
    [
      source.mode,
      source.order,
      source.layout,
      source.placement ?? null,
      source.groups,
      source.root ?? null,
    ],
    [raw.mode, raw.order, raw.layout, raw.placement, raw.groups, raw.root],
    raw.id,
  );
  equal(
    source.sequence,
    raw.sequence.map((item) => item.item),
    raw.id,
  );
  const sequence = raw.sequence.map((item, index) => ({
    ...item,
    item: required(source.sequence[index], raw.id),
  }));
  return {
    ...raw,
    mode: source.mode,
    layout: source.layout,
    placement: source.placement ?? null,
    groups: source.groups,
    nodes: raw.nodes.map((node) => readNode(node, collection)),
    wires: raw.wires.map((wire) => readWire(wire, source, collection)),
    sequence,
  };
}
/** Decode a detached measured projection without native font loading; Model owns canonical validity and caller owns retry. */
export function readProjection(
  input: unknown,
  canonical: unknown,
  domain: DomainReader,
): Projection {
  const collection = requireValue(domain.read(clone(canonical)));
  const raw = parse(projectionEnvelope, clone(input));
  requireValue(requireProjectionCapacity(raw.sections));
  equal(
    [collection.id, collection.revision, collection.title, collection.arrangement],
    [raw.collectionId, raw.revision, raw.title, raw.arrangement],
    'projection',
  );
  equal(
    collection.sections.map((item) => item.id),
    raw.sections.map((item) => item.id),
    'sections',
  );
  equal(collection.theme.digest, `sha256:${raw.styleDigest}`, 'styleDigest');
  equal(
    collection.assets.map((item) => item.digest.slice(7)),
    raw.assetDigests,
    'assetDigests',
  );
  return {
    ...raw,
    arrangement: collection.arrangement,
    sections: raw.sections.map((section) => readSection(section, collection)),
  };
}
