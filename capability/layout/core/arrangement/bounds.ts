import type {
  Box,
  PlacedNode,
  RoutedWire,
  SequenceGeometry,
} from '../../contract/records/geometry.js';
import type { MeasuredContent } from '../../contract/records/input.js';
import { union, pointBounds, expand } from '../geometry/bounds.js';
/** Complete visible bounds include routes, labels, nested sequence frames and activation/lifeline extents. */
export function contentBounds(
  nodes: readonly PlacedNode[],
  wires: readonly RoutedWire[],
  sequence: SequenceGeometry,
): Box {
  return union([
    ...nodes.map((item) => item.box),
    ...wires.flatMap((item) => [
      pointBounds(item.points),
      ...(item.labelVisible === false ? [] : [item.labelBox]),
    ]),
    ...sequence.events.flatMap((item) => [item.labelBox, pointBounds(item.points)]),
    ...sequence.fragments.map((item) => item.box),
    ...sequence.activations.map((item) => item.box),
    ...sequence.lifelines.map((item) => pointBounds([item.from, item.to])),
  ]);
}
/** Section title sits above the full content, even when locked nodes have negative local coordinates. */
export function titleBox(
  content: Box,
  measured: MeasuredContent,
  padding: number,
): Box {
  return {
    x: content.x,
    y: content.y - padding - measured.height,
    width: measured.width,
    height: measured.height,
  };
}
/** A section's local visible bounds reserve its measured heading and outer padding. */
export function sectionBounds(
  content: Box,
  title: Box,
  padding: number,
): Box {
  return expand(union([content, title]), padding);
}
