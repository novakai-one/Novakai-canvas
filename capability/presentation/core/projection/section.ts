import { moduleEnvelopes } from './module-envelopes.js';
import type { Section, Endpoint, Relationship } from '../../contract/records/input.js';
import type {
  VisualSection,
  VisualNode,
  VisualEndpoint,
  VisualWire,
} from '../../contract/records/visual.js';
import type { ContentContext } from '../content/blocks.js';
import { identity, projectNode, projectGroup } from './node.js';
import { labelContent } from '../content/headings.js';
import { wireNotation, sequenceMarker, sequenceLabel } from '../notation/wires.js';
import { measureWireAnnotation } from '../notation/annotations.js';
import { reject } from '../validation/outcomes.js';
/** Canonical endpoints resolve through the visible representation, including represented groups. */
function endpoint(
  value: Endpoint,
  nodes: readonly VisualNode[],
): VisualEndpoint {
  const node = nodes.find((item) => item.objectId === value.object);
  if (!node)
    return reject('invalid-input', value.object, 'Wire endpoint has no visible representation');
  return { node: node.id, member: value.member ?? null };
}
/** Missing relationship is a broken domain-reader contract and rejects the whole projection. */
function relationship(
  id: string,
  context: ContentContext,
): Relationship {
  const found = context.collection.relationships.find((item) => item.id === id);
  if (!found) return reject('invalid-input', id, 'Relationship is missing');
  return found;
}
/** Wires retain local manual-route controls as data; no router runs during measurement. */
function wire(
  route: Section['wires'][number],
  section: Section,
  nodes: readonly VisualNode[],
  context: ContentContext,
): VisualWire {
  const source = relationship(route.relationship, context);
  const notation = wireNotation(source);
  return {
    id: identity(section.id, 'object', `wire:${source.id}`),
    relationshipId: source.id,
    sectionId: section.id,
    kind: source.kind,
    source: endpoint(source.source, nodes),
    target: endpoint(source.target, nodes),
    label: measureWireAnnotation(source, context),
    // Flow and state transitions carry their branch meaning in the wire label;
    // module roads stay quiet unless the user focuses a wire.
    labelVisible: section.mode === 'flow' || section.mode === 'state',
    appearance: connectionPaint(context.style.connection, notation.style),
    sourceMarker: notation.source,
    targetMarker: notation.target,
    style: notation.style,
    route,
  };
}
/** Measure one section; public project owns rejection and Authoring retains the prior scene. */
export function projectSection(
  section: Section,
  context: ContentContext,
): VisualSection {
  const nodes = [
    ...section.groups.map((group) => projectGroup(group, section, context)),
    ...section.appearances.map((view) => projectNode(view, section, context)),
  ];
  return moduleEnvelopes(
    {
      id: section.id,
      title: sectionTitle(section.title, context),
      mode: section.mode,
      order: section.order,
      layout: section.layout,
      placement: section.placement ?? null,
      nodes,
      wires: section.wires.map((item) => wire(item, section, nodes, context)),
      sequence: section.sequence.map((item) => ({
        item,
        label: labelContent(sequenceLabel(item), context, 'annotation'),
        marker: sequenceMarker(item),
      })),
      groups: section.groups,
      root: section.root ?? null,
    },
    context,
  );
}
/** Section headings may use the generic large-band ceiling; measured width remains content-driven. */
function sectionTitle(
  title: string,
  context: ContentContext,
): VisualSection['title'] {
  const width = context.style.contentSizing.widths.large.maximum;
  return labelContent(title, { ...context, width }, 'sectionHeading');
}

/** Optional theme ink varies appearance only; semantic routing and marker geometry remain shared. */
function connectionPaint(
  connection: ContentContext['style']['connection'],
  style: VisualWire['style'],
): ContentContext['style']['connection'] {
  if (style !== 'dashed') return connection;
  if (connection.dashedPaint === undefined) return connection;
  return { ...connection, paint: connection.dashedPaint };
}
