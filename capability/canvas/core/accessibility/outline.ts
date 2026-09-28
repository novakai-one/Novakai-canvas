import type { SessionState } from '../../contract/records/state.js';
import type { OutlineSection, OutlineEntry } from '../../contract/records/view.js';
import type { PlacedSection, PlacedNode, RoutedWire } from '../../contract/records/scene.js';
/** Every measured row/alt description is preserved in the accessible alternative to the graphical node. */
function nodeEntry(
  node: PlacedNode,
  section: PlacedSection,
): OutlineEntry {
  return {
    target: { kind: 'node', section: section.id, id: node.id },
    label: node.measured.label,
    description: [node.measured.kind, ...node.measured.content.outline],
    endpoints: node.measured.content.anchors.map((anchor) => ({
      member: anchor.member,
      label: anchor.label,
      direction: anchor.direction,
    })),
  };
}
/** Human-readable marker names describe cardinality without requiring users to recognize a glyph. */
const markers = {
  none: '',
  arrow: 'directed',
  'open-arrow': 'directed',
  one: 'exactly one',
  'zero-one': 'zero or one',
  'one-many': 'one or many',
  'zero-many': 'zero or many',
};
/** Wire narration retains required labels, endpoint row/member identity and both cardinalities. */
function wireEntry(
  wire: RoutedWire,
  section: PlacedSection,
): OutlineEntry {
  const source =
    section.nodes.find((node) => node.id === wire.source.node)?.measured.label ?? wire.source.node;
  const target =
    section.nodes.find((node) => node.id === wire.target.node)?.measured.label ?? wire.target.node;
  return {
    target: { kind: 'wire', section: section.id, id: wire.id },
    label: wire.measuredLabel.outline.join(' '),
    description: [
      `${source} ${wire.source.member ?? ''} (${markers[wire.sourceMarker]}) → ${target} ${wire.target.member ?? ''} (${markers[wire.targetMarker]})`,
    ],
    endpoints: [],
  };
}
/** Supplied sequence source determines semantic order/branch structure; geometry does not become a second sequence model. */
function sequenceEntries(section: PlacedSection): readonly OutlineEntry[] {
  return section.sequence.source.map((source): OutlineEntry => {
    const item = source.item;
    const details =
      item.kind === 'fragment'
        ? item.branches.map((branch) => branch.label)
        : [item.source, item.target, item.message];
    return {
      target: { kind: 'sequence', section: section.id, id: item.id },
      label: source.label.outline.join(' '),
      description: [
        item.kind,
        `parent ${item.parent ?? 'root'}`,
        `branch ${item.branch ?? 'none'}`,
        `order ${item.order}`,
        ...details,
      ],
      endpoints: [],
    };
  });
}
/** Readable collection outline is a pure public projection; host binds explicit Locate/Edit controls. */
export function describeScene(state: SessionState): readonly OutlineSection[] {
  return state.scene.sections.map((section) => ({
    target: { kind: 'section', id: section.id },
    title: section.title.content.outline.join(' '),
    entries: [
      ...section.nodes.map((node) => nodeEntry(node, section)),
      ...section.wires.map((wire) => wireEntry(wire, section)),
      ...sequenceEntries(section),
    ],
  }));
}
