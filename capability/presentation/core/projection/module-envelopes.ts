import { markerMeasurements } from '../notation/markers.js';
import type {
  VisualNode,
  VisualSection,
  VisualWire,
  ModuleEnvelope,
} from '../../contract/records/visual.js';
import type { ResolvedStyle } from '../../contract/records/style.js';
type EnvelopeContext = { readonly style: ResolvedStyle };

/** Presentation owns container footprints before any routing runs. Reserves are based on
 * measured content and connection density, never on a router's calculated geometry. */
export function moduleEnvelopes(
  section: VisualSection,
  context: EnvelopeContext,
): VisualSection {
  if (section.mode !== 'modules') return section;
  const annotated = { ...section, wires: annotationOwners(section.wires) };
  const measured = new Map<string, VisualNode>();
  const envelope = measure(null, annotated, context, measured);
  return {
    ...annotated,
    envelope,
    nodes: section.nodes.map((node) => measured.get(node.id) ?? node),
  };
}
/** Reserve at each immediate boundary only; a child's internal links consume its own space. */
function density(
  members: readonly VisualNode[],
  all: readonly VisualNode[],
  wires: readonly VisualWire[],
): { perimeter: number; local: number } {
  const owners = new Map<string, string>();
  members.forEach((member) =>
    descendants([member], all).forEach((node) => owners.set(node.id, member.id)),
  );
  const counts = new Map<string, number>();
  let perimeter = 0;
  wires.forEach((wire) => {
    const from = owners.get(wire.source.node),
      to = owners.get(wire.target.node);
    if (from === to) return;
    perimeter += 1;
    if (from !== undefined) counts.set(`${from}:out`, (counts.get(`${from}:out`) ?? 0) + 1);
    if (to !== undefined) counts.set(`${to}:in`, (counts.get(`${to}:in`) ?? 0) + 1);
  });
  return { perimeter, local: Math.max(0, ...counts.values()) };
}
function measure(
  parent: VisualNode | null,
  section: VisualSection,
  context: EnvelopeContext,
  measured: Map<string, VisualNode>,
): ModuleEnvelope {
  const members = section.nodes.filter((node) => node.parent === (parent?.id ?? null));
  const leaves = members.filter((node) => node.groupId === null);
  const groups = members.filter((node) => node.groupId !== null);
  const children = groups.map((node) => {
    const envelope = measure(node, section, context, measured);
    measured.set(node.id, { ...node, width: envelope.width, height: envelope.height, envelope });
    return envelope;
  });
  const padding = context.style.padding;
  const labels = section.wires
    .filter((wire) => wire.labelVisible !== false)
    .map((wire) => wire.label);
  // Parallel strokes need their own ink width as clearance; label whitespace stays independent.
  const stroke = Math.max(
    context.style.connection.width,
    ...section.wires.map((wire) => wire.appearance.width),
  );
  const lanePitch = Math.max(stroke * 2, context.style.gap / 2);
  const markers = markerMeasurements();
  const advance = Math.max(
    0,
    ...section.wires.flatMap((wire) => [
      markers[wire.sourceMarker].advance,
      markers[wire.targetMarker].advance,
    ]),
  );
  const annotationGap = context.style.gap;
  const terminalPitch = Math.max(
    lanePitch * 2,
    ...labels.map((label) => label.height + annotationGap * 2),
  );
  const traffic = density(members, section.nodes, section.wires);
  const gap = trafficGap(traffic.perimeter, lanePitch, padding);
  const cellGap = trafficGap(traffic.local, lanePitch, padding);
  // Each child reserves its own boundary population. Shared-road feasibility is admitted by Layout.
  const childCells = children.map((child, index) => {
    const boundary = density([groups[index]!], section.nodes, section.wires);
    const clearance = trafficGap(boundary.local, lanePitch, padding);
    return {
      width: child.width + clearance,
      height: child.height + clearance,
    };
  });
  const own = section.groups.find((group) => group.id === parent?.groupId)?.layout;
  // A group follows its section's direction unless it names another one ('right' is the default).
  const intent =
    own === undefined
      ? section.layout
      : { ...own, direction: own.direction === 'right' ? section.layout.direction : own.direction };
  const leafGrid = dependencyGrid(leaves, section, intent);
  const nested = dependencyGrid(groups, section, intent);
  const columns = leafGrid.columns;
  const childColumns = nested.columns;
  const footprints = leaves.map((node) =>
    nodeFootprint(node, section.wires, lanePitch, annotationGap, advance),
  );
  const horizontal = tracks(leaves, footprints, leafGrid, 'x', cellGap, gap / 2);
  const header = Math.ceil((parent?.headerHeight ?? section.title.height + padding * 2) + gap / 2);
  const vertical = tracks(leaves, footprints, leafGrid, 'y', cellGap, header);
  const columnWidths = horizontal.sizes;
  const rowHeights = vertical.sizes;
  const pitch = { x: Math.max(gap, ...columnWidths), y: Math.max(gap, ...rowHeights) };
  const column = (index: number) => (nested.cells[index] ?? index) % childColumns;
  const row = (index: number) => Math.floor((nested.cells[index] ?? index) / childColumns);
  const childColumnWidths = Array.from({ length: gridSize(nested).columns }, (_, track) =>
    Math.max(0, ...childCells.filter((_, index) => column(index) === track).map((c) => c.width)),
  );
  const childRowHeights = Array.from({ length: gridSize(nested).rows }, (_, track) =>
    Math.max(0, ...childCells.filter((_, index) => row(index) === track).map((c) => c.height)),
  );
  const childWidth = childColumnWidths.reduce((sum, width) => sum + width, 0);
  const childHeight = childRowHeights.reduce((sum, height) => sum + height, 0);
  const ownWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const ownHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const pinned = leaves.filter((node) => node.placement !== null);
  const manualWidth = Math.max(
    0,
    ...pinned.map(
      (node) => node.placement!.x + Math.max(node.width, node.placement!.width ?? 0) + gap,
    ),
  );
  const manualHeight = Math.max(
    0,
    ...pinned.map(
      (node) => node.placement!.y + Math.max(node.height, node.placement!.height ?? 0) + gap,
    ),
  );
  const childInsets = children.map((child, index) => ({
    x: Math.min(gap / 2, ((childColumnWidths[column(index)] ?? 0) - child.width) / 2),
    y: ((childRowHeights[row(index)] ?? 0) - child.height) / 2,
  }));
  const childX = edges(childColumnWidths);
  const childY = edges(childRowHeights);
  const rects = groups.map((node, index) => ({
    node,
    pinned: node.placement !== null,
    x:
      node.placement?.x ??
      gap / 2 + ownWidth + (childX[column(index)] ?? 0) + (childInsets[index]?.x ?? 0),
    y: node.placement?.y ?? header + (childY[row(index)] ?? 0) + (childInsets[index]?.y ?? 0),
    width: children[index]?.width ?? 0,
    height: children[index]?.height ?? 0,
  }));
  // The road between child columns (rows) runs on the grid line; a pinned group stays past it.
  const reach = pushPinned(
    rects.map((rect, index) => ({
      ...rect,
      minX: column(index) === 0 ? -Infinity : ownWidth + (childX[column(index)] ?? 0) + gap,
      minY: row(index) === 0 ? -Infinity : header + (childY[row(index)] ?? 0) + gap / 2,
    })),
    measured,
  );
  const authored = parent === null ? section.placement : parent.placement;
  // An authored size still grows to hold a child moved past its right or bottom edge.
  return {
    width:
      authored?.width == null
        ? Math.max(
            manualWidth,
            reach.right + gap / 2,
            Math.max(parent?.content.width ?? section.title.width, ownWidth + childWidth) + gap,
          )
        : Math.max(authored.width, manualWidth, reach.right + gap / 2),
    height:
      authored?.height == null
        ? Math.max(
            manualHeight,
            reach.bottom + gap / 2,
            Math.max(ownHeight, childHeight) + header + gap / 2,
          )
        : Math.max(authored.height, manualHeight, reach.bottom + gap / 2),
    header,
    gap,
    lanePitch,
    annotationGap,
    terminalPitch,
    columns,
    childColumns,
    cells: leafGrid.cells,
    childCells: nested.cells,
    childColumnWidths,
    childRowHeights,
    // Start-align columns within the parent reserve while preserving shared row centres.
    childInsets,
    pitch,
    columnWidths,
    rowHeights,
    columnCenters: horizontal.centers,
    rowCenters: vertical.centers,
  };
}

interface Grid {
  readonly columns: number;
  /** Row-major cell of each member, in member order. */
  readonly cells: readonly number[];
}
function gridSize(grid: Grid): { readonly columns: number; readonly rows: number } {
  const used = Math.max(0, ...grid.cells.map((cell) => cell + 1));
  return { columns: Math.min(grid.columns, used), rows: Math.ceil(used / grid.columns) };
}

type Link = readonly [number, number];
/** Members that depend on each other line up with the section direction: each wire's source sits
 * before its target (left of it for right, above it for down). Otherwise members fill a
 * near-square grid in their own order. */
function dependencyGrid(
  members: readonly VisualNode[],
  section: VisualSection,
  intent: VisualSection['layout'],
): Grid {
  const square = Math.ceil(Math.sqrt(members.length));
  const plain = {
    columns: Math.max(1, Math.min(members.length || 1, intent.columns ?? square)),
    cells: members.map((_, index) => index),
  };
  if (keepsOrder(members, section, intent)) return plain;
  const links = memberLinks(members, section);
  return links.length === 0 ? plain : layeredGrid(layerOf(members.length, links), intent.direction);
}
/** Authored columns or a hand-placed member: keep the human's arrangement, don't reshuffle. */
function keepsOrder(
  members: readonly VisualNode[],
  section: VisualSection,
  intent: VisualSection['layout'],
): boolean {
  const placed = descendants(members, section.nodes).some((node) => node.placement !== null);
  return placed || intent.columns !== undefined;
}
/** Wires between different members, as member indexes; a wire inside one member is ignored. */
function memberLinks(
  members: readonly VisualNode[],
  section: VisualSection,
): readonly Link[] {
  const owner = new Map<string, number>();
  members.forEach((member, index) =>
    descendants([member], section.nodes).forEach((node) => owner.set(node.id, index)),
  );
  return section.wires.flatMap((wire) =>
    link(owner.get(wire.source.node), owner.get(wire.target.node)),
  );
}
function link(
  from: number | undefined,
  to: number | undefined,
): readonly Link[] {
  return from === undefined || to === undefined || from === to ? [] : [[from, to]];
}
const STACKED = new Set(['down', 'up']);
const REVERSED = new Set(['left', 'up']);
/** Layer runs along the direction; members of one layer sit side by side across it. */
function layeredGrid(
  layers: readonly number[],
  direction: string,
): Grid {
  const depth = Math.max(...layers) + 1;
  const order = layers.map((_, index) => index);
  const across = Array.from({ length: depth }, (_, layer) =>
    order.filter((index) => layers[index] === layer),
  );
  const position = (index: number) => across[layers[index] ?? 0]?.indexOf(index) ?? 0;
  const flip = REVERSED.has(direction) ? depth - 1 : 0;
  const step = (index: number) => Math.abs(flip - (layers[index] ?? 0));
  const width = Math.max(...across.map((layer) => layer.length));
  return STACKED.has(direction)
    ? { columns: width, cells: order.map((index) => step(index) * width + position(index)) }
    : { columns: depth, cells: order.map((index) => position(index) * depth + step(index)) };
}
/** Longest path from members nothing points at. A cycle is broken at its first member. */
function layerOf(
  count: number,
  links: readonly Link[],
): readonly number[] {
  const layers = Array.from({ length: count }, () => 0);
  const placed = new Set<number>();
  layers.forEach(() => placeNext(layers, placed, links));
  return layers;
}
/** Place every member whose sources are all placed; with none ready, place the first open one. */
function placeNext(
  layers: number[],
  placed: Set<number>,
  links: readonly Link[],
): void {
  const open = layers.map((_, index) => index).filter((index) => !placed.has(index));
  const ready = open.filter((index) => links.every((l) => waitsOn(l, index, placed)));
  const next = ready.length > 0 ? ready : open.slice(0, 1);
  next.forEach((index) => {
    const before = links.filter(([from, to]) => to === index && placed.has(from));
    layers[index] = Math.max(0, ...before.map(([from]) => (layers[from] ?? 0) + 1));
  });
  next.forEach((index) => placed.add(index));
}
function waitsOn(
  [from, to]: Link,
  index: number,
  placed: ReadonlySet<number>,
): boolean {
  return to !== index || from === index || placed.has(from);
}

/** Running totals: where each grid column (row) starts. */
function edges(sizes: readonly number[]): readonly number[] {
  return sizes.reduce<readonly number[]>((all, size) => [...all, (all.at(-1) ?? 0) + size], [0]);
}

/** A pinned group left of (or above) the road beside its grid cell moves past it.
 * Returns the far edges of pinned groups so the parent grows to hold them. */
function pushPinned(
  rects: readonly {
    readonly node: VisualNode;
    readonly pinned: boolean;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly minX: number;
    readonly minY: number;
  }[],
  measured: Map<string, VisualNode>,
): { readonly right: number; readonly bottom: number } {
  const pinned = rects
    .filter((rect) => rect.pinned)
    .map((rect) => ({ ...rect, x: Math.max(rect.x, rect.minX), y: Math.max(rect.y, rect.minY) }));
  pinned.forEach((rect) => {
    const node = measured.get(rect.node.id) ?? rect.node;
    const placement = node.placement;
    if (placement === null || (rect.x === placement.x && rect.y === placement.y)) return;
    measured.set(rect.node.id, { ...node, placement: { ...placement, x: rect.x, y: rect.y } });
  });
  return {
    right: Math.max(0, ...pinned.map((rect) => rect.x + rect.width)),
    bottom: Math.max(0, ...pinned.map((rect) => rect.y + rect.height)),
  };
}

/** A style-derived spacing policy, not a promise that every route fits this capacity. */
function trafficGap(
  population: number,
  pitch: number,
  padding: number,
): number {
  return Math.ceil(Math.max(padding * 4, (population + 2) * pitch * 2 + padding * 2));
}

function descendants(
  members: readonly VisualNode[],
  all: readonly VisualNode[],
): readonly VisualNode[] {
  return members.flatMap((node) => [
    node,
    ...descendants(
      all.filter((child) => child.parent === node.id),
      all,
    ),
  ]);
}

interface Footprint {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
type Side = keyof Footprint;

/** Cell bounds include body, compact unselected approaches and the selected annotation bands. */
function nodeFootprint(
  node: VisualNode,
  wires: readonly VisualWire[],
  pitch: number,
  labelGap: number,
  advance: number,
): Footprint {
  const exits = wires.filter((wire) => wire.source.node === node.id);
  const entries = wires.filter((wire) => wire.target.node === node.id);
  const width = Math.max(node.width, node.placement?.width ?? 0);
  const height = Math.max(node.height, node.placement?.height ?? 0);
  const count = Math.max(exits.length, entries.length);
  const compact = count === 0 ? 0 : (count + 1) * pitch + Math.max(0, advance - pitch);
  const body = {
    left: width / 2 + compact,
    right: width / 2 + compact,
    top: height / 2 + compact,
    bottom: height / 2 + compact,
  };
  return annotatedFootprint(
    annotatedFootprint(body, node, exits, 'source', pitch, labelGap, advance),
    node,
    entries,
    'target',
    pitch,
    labelGap,
    advance,
  );
}

/** Orthogonal lanes share the body's across-axis span instead of adding it a second time. */
function annotatedFootprint(
  body: Footprint,
  node: VisualNode,
  wires: readonly VisualWire[],
  endpoint: 'source' | 'target',
  pitch: number,
  gap: number,
  advance: number,
): Footprint {
  const selected = wires.filter(
    (wire) => wire.labelVisible !== false && wire.annotationEndpoint === endpoint,
  );
  const normal = (wires.length + 1) * pitch + Math.max(0, advance - pitch);
  const directions: Readonly<Record<Side, Side>> =
    endpoint === 'source'
      ? { right: 'bottom', left: 'top', bottom: 'left', top: 'right' }
      : { left: 'bottom', right: 'top', top: 'left', bottom: 'right' };
  return (['left', 'right', 'top', 'bottom'] as const).reduce((bounds, side) => {
    const labels = selected.filter((wire) => annotationSide(wire, endpoint) === side);
    if (labels.length === 0) return bounds;
    const lateral = side === 'left' || side === 'right';
    const across = lateral ? 'height' : 'width';
    const along = lateral ? 'width' : 'height';
    const pitches = labels.map((wire) => wire.label[across] + gap * 2 + 1);
    const band = Math.min(
      (wires.length + 1) * Math.max(pitch, ...pitches),
      (wires.length + 1) * pitch + 2 * pitches.reduce((sum, value) => sum + value - pitch, 0),
    );
    const crossSide = directions[side];
    const anchors = labels.map((wire) => anchorOffset(node, wire, endpoint, crossSide));
    return {
      ...bounds,
      [side]: Math.max(
        bounds[side],
        node[along] / 2 +
          normal +
          Math.max(...labels.map((wire) => wire.label[along] + gap * 2 + 1)),
      ),
      [crossSide]: Math.max(bounds[crossSide], band + Math.max(...anchors)),
    };
  }, body);
}
function annotationSide(
  wire: VisualWire,
  endpoint: 'source' | 'target',
): Side {
  const side = endpoint === 'source' ? wire.route.sourceSide : wire.route.targetSide;
  return side === 'auto' ? (endpoint === 'source' ? 'right' : 'left') : side;
}
function anchorOffset(
  node: VisualNode,
  wire: VisualWire,
  endpoint: 'source' | 'target',
  side: Side,
): number {
  const anchor = node.content.anchors.find((item) => item.member === wire[endpoint].member);
  if (anchor === undefined) return 0;
  return (anchor.y - node.height / 2) * (side === 'top' ? -1 : 1);
}

/** Manual placements reserve their own cell before roads are built; automatic nodes retain grid order. */
function tracks(
  nodes: readonly VisualNode[],
  cells: readonly Footprint[],
  grid: Grid,
  axis: 'x' | 'y',
  gap: number,
  origin: number,
) {
  const count = axis === 'x' ? gridSize(grid).columns : gridSize(grid).rows;
  const columns = grid.columns;
  const before = axis === 'x' ? 'left' : 'top';
  const after = axis === 'x' ? 'right' : 'bottom';
  const dimension = axis === 'x' ? 'width' : 'height';
  const sizes: number[] = [],
    centers: number[] = [];
  let start = origin;
  for (let track = 0; track < count; track++) {
    const members = nodes
      .map((node, index) => ({
        node,
        cell: cells[index]!,
        track:
          axis === 'x'
            ? (grid.cells[index] ?? index) % columns
            : Math.floor((grid.cells[index] ?? index) / columns),
      }))
      .filter((item) => item.track === track);
    const lead = Math.max(...members.map((item) => item.cell[before]));
    const trail = Math.max(...members.map((item) => item.cell[after]));
    const pinned = members
      .filter((item) => item.node.placement !== null)
      .map(
        ({ node, cell }) =>
          node.placement![axis] +
          Math.max(node[dimension], node.placement![dimension] ?? 0) / 2 +
          cell[after] +
          gap / 2 -
          start,
      );
    const size = Math.ceil(Math.max(lead + trail + gap, ...pinned));
    sizes.push(size);
    centers.push(lead + gap / 2);
    start += size;
  }
  return { sizes, centers };
}

/** Annotation ownership is semantic and fixed before measuring any module envelope. */
function annotationOwners(wires: readonly VisualWire[]): readonly VisualWire[] {
  return wires.map((wire) => {
    const exits = wires.filter((other) => other.source.node === wire.source.node).length;
    const entries = wires.filter((other) => other.target.node === wire.target.node).length;
    return { ...wire, annotationEndpoint: exits <= entries ? 'source' : 'target' };
  });
}
