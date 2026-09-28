/** Measured grid placement is pure and replayable; validated input enters through Layout execute, whose caller retains the previous scene on failure. */
import type { LayoutIntent } from '../../contract/records/input.js';
import type { PlacementNode, PlacementValue } from '../../contract/records/problem.js';
interface Cell {
  readonly column: number;
  readonly row: number;
}
interface Tracks {
  readonly widths: readonly number[];
  readonly heights: readonly number[];
}
interface AxisGaps {
  readonly x: number;
  readonly y: number;
}
/** Each row and column reserves its own largest member; one tall diagram cannot inflate every row in a collection. */
export function gridPlacement(
  nodes: readonly PlacementNode[],
  columns: number,
  spacing: number,
  layerSpacing: number,
  direction: LayoutIntent['direction'],
  physicalColumns = false,
): readonly PlacementValue[] {
  const stride = readingStride(nodes.length, columns, direction, physicalColumns);
  const cells = nodes.map((_, index): Cell => cell(index, stride, direction));
  const tracks = measureTracks(nodes, cells);
  return nodes.map((node, index) =>
    place(node, cells[index] ?? { column: 0, row: 0 }, tracks, spacing, layerSpacing, direction),
  );
}
/** Down/up transpose row-major reading order; reverse directions preserve negative logical coordinates. */
function cell(
  index: number,
  columns: number,
  direction: LayoutIntent['direction'],
): Cell {
  const column = index % columns;
  const row = Math.floor(index / columns);
  if (direction === 'down' || direction === 'up') return { column: row, row: column };
  return { column, row };
}
/** Track extents are derived only from measured members assigned to that track. */
function measureTracks(
  nodes: readonly PlacementNode[],
  cells: readonly Cell[],
): Tracks {
  return {
    widths: trackSizes(nodes, cells, 'column', 'width'),
    heights: trackSizes(nodes, cells, 'row', 'height'),
  };
}
/** Empty input yields no tracks; no invented cell dimensions enter the scene. */
function trackSizes(
  nodes: readonly PlacementNode[],
  cells: readonly Cell[],
  axis: keyof Cell,
  size: 'width' | 'height',
): readonly number[] {
  const count = Math.max(-1, ...cells.map((item) => item[axis])) + 1;
  return Array.from({ length: count }, (_, track) =>
    Math.max(
      0,
      ...nodes.filter((_, index) => cells[index]?.[axis] === track).map((node) => node[size]),
    ),
  );
}
/** A track begins after the preceding measured extents and the explicit gap between them. */
function offset(
  sizes: readonly number[],
  index: number,
  gap: number,
): number {
  return sizes.slice(0, index).reduce((sum, size) => sum + size, 0) + index * gap;
}
/** Reverse tracks align their trailing edge at the same origin; unequal boxes remain nonoverlapping. */
function place(
  node: PlacementNode,
  cell: Cell,
  tracks: Tracks,
  spacing: number,
  layerSpacing: number,
  direction: LayoutIntent['direction'],
): PlacementValue {
  const gap = axisGaps(spacing, layerSpacing)[direction];
  const x = offset(tracks.widths, cell.column, gap.x);
  const y = offset(tracks.heights, cell.row, gap.y);
  return {
    id: node.id,
    box: {
      x: direction === 'left' ? -x - node.width : x,
      y: direction === 'up' ? -y - node.height : y,
      width: node.width,
      height: node.height,
    },
  };
}

/** Physical axes receive the local flow/cross minima without changing column membership. */
function axisGaps(
  spacing: number,
  layerSpacing: number,
): Readonly<Record<LayoutIntent['direction'], AxisGaps>> {
  return {
    right: { x: layerSpacing, y: spacing },
    left: { x: layerSpacing, y: spacing },
    down: { x: spacing, y: layerSpacing },
    up: { x: spacing, y: layerSpacing },
  };
}

/** Vertical explicit grids fill ceil(count/columns) rows; omission preserves the legacy transpose. */
function readingStride(
  count: number,
  columns: number,
  direction: LayoutIntent['direction'],
  physical: boolean,
): number {
  if (!physical) return columns;
  return verticalStride(count, columns, direction);
}
/** Physical track count is horizontal in every direction; pure replay needs no recovery state. */
function verticalStride(
  count: number,
  columns: number,
  direction: LayoutIntent['direction'],
): number {
  if (direction === 'down' || direction === 'up') return Math.max(1, Math.ceil(count / columns));
  return columns;
}
