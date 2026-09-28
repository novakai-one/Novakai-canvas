/** Content-first sizing, then one top-down placement pass. No road or DOM feedback. */
import type {
  PrototypeBlock,
  PrototypeBounds,
  PrototypeNode,
} from '../contract/records/road-prototype.js';
import { placePrototypeNode, measuredNode } from './prototype-road-nodes.js';

export const nestedLanePitch = 6;
/** Symmetric capacity reserves both traffic sides; reconstruction is pure and retry-safe. */
export function nestedLaneWidth(
  lanes: number,
  pitch = nestedLanePitch,
): number {
  return pitch * 2 + lanes * pitch * 2;
}
import type {
  NestedNodeSpec as NodeSpec,
  NestedSectionSpec as SectionSpec,
} from '../contract/records/nested-scene-spec.js';
export interface SizedSection {
  readonly id: string;
  readonly position?: SectionSpec['position'];
  readonly measured: NonNullable<SectionSpec['measured']>;
  readonly label: string;
  readonly count: number;
  readonly nodes: readonly NodeSpec[];
  readonly total: number;
  readonly columns: number;
  readonly rows: number;
  readonly ownWidth: number;
  readonly pitch: { readonly x: number; readonly y: number };
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly children: readonly SizedSection[];
}
export interface SectionPlacement {
  readonly section: PrototypeBlock;
  readonly size: SizedSection;
  readonly interior: PrototypeBounds;
  readonly surrounding: PrototypeBounds;
  readonly nodes: readonly PrototypeNode[];
}
function sizeSection(spec: SectionSpec): SizedSection {
  // Empty leaves retain the section header and padding without synthesizing content.
  const count = spec.nodes.length;
  const measured = spec.measured;
  if (measured === undefined) throw new Error('Presentation must supply a section envelope');
  measuredSection(measured, count);
  measuredChildren(measured, spec.children.length);
  const columns = measured.columns;
  const rows = trackCounts(measured.cells, columns)[1];
  const children = spec.children.map(sizeSection);
  const pitch = measured.pitch;
  const ownWidth = measured.columnWidths.reduce((sum, width) => sum + width, 0);
  return {
    measured,
    position: spec.position,
    id: `section-${spec.number}`,
    label: `Section ${spec.number}`,
    count,
    nodes: spec.nodes,
    total: count + children.reduce((sum, child) => sum + child.total, 0),
    columns,
    rows,
    ownWidth,
    pitch,
    columnWidths: measured.columnWidths,
    rowHeights: measured.rowHeights,
    children,
    width: measured.width,
    height: measured.height,
  };
}
/** Missing track measurements fail before any position or road is constructed. */
function measuredSection(
  measured: NonNullable<SectionSpec['measured']>,
  count: number,
): void {
  const dimensions = [
    measured.width,
    measured.height,
    measured.lanePitch,
    measured.pitch.x,
    measured.pitch.y,
    ...measured.columnWidths,
    ...measured.rowHeights,
  ];
  if (!dimensions.every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Section dimensions must be finite and positive');
  const offsets = [
    measured.header,
    measured.headerWidth,
    measured.gap,
    ...measured.columnCenters,
    ...measured.rowCenters,
  ];
  if (!offsets.every((value) => Number.isFinite(value) && value >= 0))
    throw new Error('Section offsets must be finite and nonnegative');
  if (
    ![measured.columns, measured.childColumns].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  )
    throw new Error('Measured section column counts are required');
  if (measured.cells.length !== count || measured.childCells.length !== measured.childInsets.length)
    throw new Error('Measured cells must cover every node and child section');
  const expected = trackCounts(measured.cells, measured.columns);
  const actual = [measured.columnWidths.length, measured.rowHeights.length];
  const centers = [measured.columnCenters.length, measured.rowCenters.length];
  if (!actual.every((value, index) => value === expected[index] && value === centers[index]))
    throw new Error('Measured tracks must cover every node');
}
/** Shared child tracks belong to Presentation, just like leaf tracks and section bounds. */
function measuredChildren(
  measured: NonNullable<SectionSpec['measured']>,
  count: number,
): void {
  const sizes = [
    ...measured.childColumnWidths,
    ...measured.childRowHeights,
    ...measured.childInsets.flatMap((inset) => [inset.x, inset.y]),
  ];
  if (!sizes.every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Child tracks must be finite and positive');
  const [columns, rows] = trackCounts(measured.childCells, measured.childColumns);
  if (
    measured.childColumnWidths.length !== columns ||
    measured.childRowHeights.length !== rows ||
    measured.childInsets.length !== count
  )
    throw new Error('Measured child tracks must cover every section');
}
/** Grid tracks used by row-major cells: [columns, rows]. */
function trackCounts(
  cells: readonly number[],
  columns: number,
): readonly [number, number] {
  const used = Math.max(0, ...cells.map((cell) => cell + 1));
  return [Math.min(columns, used), Math.ceil(used / columns)];
}
/** The app supplies one measured root containing every nested group. */
export function sizeNestedSections(specs: readonly SectionSpec[]): readonly SizedSection[] {
  if (specs.length !== 1) throw new Error('Nested layout requires one measured root section');
  return specs.map(sizeSection);
}
/** Top doors reserve the measured boundary lane space beyond the title; a blocked side has no door. */
function sectionPorts(
  size: SizedSection,
  bounds: PrototypeBounds,
) {
  const id = size.id;
  const clearance = size.measured.gap / 2;
  const topX = Math.max(bounds.width / 2, size.measured.headerWidth + clearance);
  const top =
    topX <= bounds.width - clearance ? [{ side: 'top' as const, offset: { x: topX, y: 0 } }] : [];
  const sides = [
    ...top,
    { side: 'left' as const, offset: { x: 0, y: bounds.height / 2 } },
    { side: 'bottom' as const, offset: { x: bounds.width / 2, y: bounds.height } },
    { side: 'right' as const, offset: { x: bounds.width, y: bounds.height / 2 } },
  ];
  return sides.flatMap((port) =>
    (['entry', 'exit'] as const).map((role) => ({
      ...port,
      role,
      id: `${id}:${role}-${port.side}`,
    })),
  );
}
function gridNodes(
  size: SizedSection,
  interior: PrototypeBounds,
) {
  if (size.count === 0) return [];
  const xEdges = gridEdges(size.columnWidths);
  const yEdges = gridEdges(size.rowHeights);
  return size.nodes.map((node, i) => {
    const measured = measuredNode(node);
    const cell = size.measured.cells[i] ?? i;
    const column = cell % size.columns,
      row = Math.floor(cell / size.columns);
    return {
      ...placePrototypeNode(
        size.id,
        node.number - 1,
        {
          x:
            interior.x +
            xEdges[column]! +
            size.measured.columnCenters[column]! -
            measured.width / 2,
          y: interior.y + yEdges[row]! + size.measured.rowCenters[row]! - measured.height / 2,
        },
        measured,
      ),
      label: node.label,
    };
  });
}
function positionSection(
  size: SizedSection,
  surrounding: PrototypeBounds,
  parentSectionId: string | null,
  parentOrigin = { x: 0, y: 0 },
  inset = { x: 0, y: 0 },
): readonly SectionPlacement[] {
  const bounds = {
    x: size.position === undefined ? surrounding.x + inset.x : parentOrigin.x + size.position.x,
    y: size.position === undefined ? surrounding.y + inset.y : parentOrigin.y + size.position.y,
    width: size.width,
    height: size.height,
  };
  const interior = {
    x: bounds.x + size.measured.gap / 2,
    y: bounds.y + size.measured.header,
    width: bounds.width - size.measured.gap,
    height: bounds.height - size.measured.header - size.measured.gap / 2,
  };
  const section = {
    id: size.id,
    label: size.label,
    bounds,
    parentSectionId,
    description: sectionDescription(size),
    ports: sectionPorts(size, bounds),
  };
  const nodes = gridNodes(size, interior).map((node, i) => {
    const position = size.nodes[i]?.position;
    return position === undefined
      ? node
      : { ...node, bounds: { ...node.bounds, x: bounds.x + position.x, y: bounds.y + position.y } };
  });
  const own = { section, size, surrounding, interior, nodes };
  const columns = size.measured.childColumns;
  const xEdges = gridEdges(size.measured.childColumnWidths);
  const yEdges = gridEdges(size.measured.childRowHeights);
  const children = size.children.flatMap((child, index) => {
    const at = size.measured.childCells[index] ?? index;
    const column = at % columns,
      row = Math.floor(at / columns);
    const cell = {
      x: interior.x + size.ownWidth + xEdges[column]!,
      y: interior.y + yEdges[row]!,
      width: size.measured.childColumnWidths[column]!,
      height: size.measured.childRowHeights[row]!,
    };
    return positionSection(child, cell, size.id, bounds, size.measured.childInsets[index]!);
  });
  return [own, ...children];
}
function sectionDescription(size: SizedSection): string {
  if (size.children.length === 0)
    return `${size.count} nodes · ${size.columns} × ${size.rows} grid`;
  return `${size.count} direct + ${size.total - size.count} nested = ${size.total} nodes`;
}
export function positionNestedSections(
  sizes: readonly SizedSection[],
): readonly SectionPlacement[] {
  const size = sizes[0];
  if (sizes.length !== 1 || size === undefined)
    throw new Error('Measured root section is required');
  return positionSection(size, { x: 0, y: 0, width: size.width, height: size.height }, null);
}

/** Cumulative owner-supplied cells define placement and the exact shared street axes. */
export function gridEdges(sizes: readonly number[]): readonly number[] {
  return sizes.reduce<readonly number[]>((edges, size) => [...edges, edges.at(-1)! + size], [0]);
}
