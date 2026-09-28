import { obstacleQuery } from './geometry/box-index.js';
import type { EngineScene } from '../contract/records/engine-scene.js';
import type { VisualSection, VisualWire, Projection } from '../contract/records/input.js';
import type { Box, Point, PlacedSection, RoutedWire } from '../contract/records/geometry.js';
import type { LayoutOptions, SupplementalMeasurements } from '../contract/types.js';
import { endpoints } from './routing/endpoints.js';
import { labelBox } from './routing/labels.js';
import { linePath, curvePath, segments } from './routing/paths.js';
import { contentBoxes, labelObstacles } from './routing/obstacles.js';
import { markerBox } from './routing/checks.js';
import { sectionKey } from './arrangement/keys.js';
import { pointBounds } from './geometry/bounds.js';
import { reject } from './validation/outcomes.js';
import { treeGeometry } from './tree.js';
import { availableSections } from './arrangement/available-space.js';

/** Preserve lane changes; redundant collinear checkpoints do not create extra SVG vertices. */
function points(
  engine: EngineScene,
  id: string,
): readonly Point[] {
  const path = engine.wires.find((w) => w.wireId === id)?.path;
  if (path === undefined) return reject('engine-failed', id, 'Custom engine omitted wire');
  const distinct = path.filter((p, i) => p.x !== path[i - 1]?.x || p.y !== path[i - 1]?.y);
  return distinct.filter((p, i) => !straight(distinct[i - 1], p, distinct[i + 1]));
}
function routeObstacles(engine: EngineScene): readonly Box[] {
  return engine.wires.flatMap((wire) => segments(wire.path).map((s) => pointBounds([s.a, s.b])));
}
function markerObstacles(
  source: VisualSection,
  engine: EngineScene,
  metrics: SupplementalMeasurements,
): readonly Box[] {
  return source.wires.flatMap((wire) => {
    const ends = endpoints(wire, engine.nodes);
    return [
      markerBox(ends.source, metrics.markers[wire.sourceMarker]),
      markerBox(ends.target, metrics.markers[wire.targetMarker]),
    ];
  });
}
function labeled(
  wire: VisualWire,
  engine: EngineScene,
  occupied: readonly Box[],
  options: LayoutOptions,
  blocked: (box: Box) => boolean,
): RoutedWire {
  const path = points(engine, wire.id);
  const label =
    wire.labelVisible === false
      ? { ...endpoints(wire, engine.nodes).source.point, width: 0, height: 0 }
      : labelBox(path, wire.label, occupied, options.labelGap, blocked);
  if (label === null)
    return reject('constraint-conflict', wire.id, 'No clear label position on custom roads');
  return {
    id: wire.id,
    ...endpoints(wire, engine.nodes),
    points: path,
    path: linePath(path),
    labelBox: label,
    measuredLabel: wire.label,
    labelVisible: wire.labelVisible,
    appearance: wire.appearance,
    sourceMarker: wire.sourceMarker,
    targetMarker: wire.targetMarker,
    style: wire.style,
  };
}
function paths(
  source: VisualSection,
  engine: EngineScene,
  metrics: SupplementalMeasurements,
  options: LayoutOptions,
): readonly RoutedWire[] {
  const obstacles = [
    ...labelObstacles(engine.nodes),
    ...routeObstacles(engine),
    ...markerObstacles(source, engine, metrics),
  ];
  const blocked = obstacleQuery(obstacles);
  const wires = source.wires.reduce<readonly RoutedWire[]>(
    (done, wire) => [
      ...done,
      labeled(
        wire,
        engine,
        done.filter((w) => w.labelVisible !== false).map((w) => w.labelBox),
        options,
        blocked,
      ),
    ],
    [],
  );
  const curves = [
    ...contentBoxes(engine.nodes),
    ...wires.filter((w) => w.labelVisible !== false).map((w) => w.labelBox),
  ];
  return wires.map((wire, i) =>
    source.wires[i]?.route.route === 'curve'
      ? { ...wire, path: curvePath(wire.points, options.routeClearance / 2, curves) }
      : wire,
  );
}
/** Return the app's existing measured Scene records; no native placer, solver or router is invoked. */
export function toAppSection(
  engine: EngineScene,
  source: VisualSection,
  metrics: SupplementalMeasurements,
  options: LayoutOptions,
  versions: readonly string[],
): PlacedSection {
  const wires = paths(source, engine, metrics, options);
  const sequence = {
    lifelines: [],
    events: [],
    fragments: [],
    activations: [],
    source: source.sequence,
  };
  const title = {
    content: source.title,
    box: {
      x: engine.frame.x + options.padding,
      y: engine.frame.y + options.padding,
      width: source.title.width,
      height: source.title.height,
    },
  };
  return {
    routing: engine.routing,
    id: source.id,
    origin: { x: 0, y: 0 },
    box: engine.frame,
    title,
    nodes: engine.nodes,
    wires,
    sequence,
    ...(treeGeometry(source) === undefined ? {} : { tree: treeGeometry(source) }),
    inputKey: sectionKey(source, metrics, options, versions),
  };
}
/** Collection packing only translates section origins; all custom node and wire geometry stays intact. */
export function placeAppSections(
  sections: readonly PlacedSection[],
  projection: Projection,
  options: LayoutOptions,
): readonly PlacedSection[] {
  const gap = options.gap[projection.arrangement.gap];
  const columns =
    projection.arrangement.columns ?? Math.max(1, Math.ceil(Math.sqrt(sections.length)));
  const rows = Array.from({ length: Math.ceil(sections.length / columns) }, (_, i) =>
    sections.slice(i * columns, (i + 1) * columns),
  );
  let y = 0;
  const preferred = rows.flatMap((row) => {
    let x = 0;
    const placed = row.map((section) => {
      const authored = projection.sections.find((s) => s.id === section.id)?.placement;
      const box = {
        ...section.box,
        width: authored?.width ?? section.box.width,
        height: authored?.height ?? section.box.height,
      };
      const origin = authored ?? { x: x - section.box.x, y: y - section.box.y };
      x += box.width + gap;
      return {
        ...section,
        origin: { x: origin.x, y: origin.y },
        box: { ...box, x: section.box.x + origin.x, y: section.box.y + origin.y },
      };
    });
    y += Math.max(...placed.map((s) => s.box.height)) + gap;
    return placed;
  });
  return availableSections(preferred, projection, gap);
}

function straight(
  before: Point | undefined,
  point: Point,
  after: Point | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  return (
    Math.sign(point.x - before.x) === Math.sign(after.x - point.x) &&
    Math.sign(point.y - before.y) === Math.sign(after.y - point.y)
  );
}
