import type { PrototypeBounds, PrototypeRoadCoverage } from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { contains } from './prototype-road-geometry.js';

interface Cell {
  readonly bounds: PrototypeBounds;
  readonly roadIds: readonly string[];
  readonly regionIds: readonly string[];
}
function cuts(
  boxes: readonly PrototypeBounds[],
  axis: 'x' | 'y',
  size: 'width' | 'height',
): readonly number[] {
  return [...new Set(boxes.flatMap((box) => [box[axis], box[axis] + box[size]]))].toSorted(
    (a, b) => a - b,
  );
}
function spans(cuts: readonly number[]) {
  return cuts
    .slice(1)
    .map((end, index) => ({ start: cuts[index] ?? end, length: end - (cuts[index] ?? end) }));
}
/** Every rectangle boundary partitions the plane, so membership is constant over each whole cell. */
function cells(scene: RoadPrototypeScene): readonly Cell[] {
  const regions = [...scene.lanes, ...scene.junctions];
  const boxes = [...scene.roads, ...regions].map((item) => item.bounds);
  const xs = spans(cuts(boxes, 'x', 'width')),
    ys = spans(cuts(boxes, 'y', 'height'));
  return xs.flatMap((x) =>
    ys.map((y) => {
      const bounds = { x: x.start, y: y.start, width: x.length, height: y.length };
      const center = { x: x.start + x.length / 2, y: y.start + y.length / 2 };
      return {
        bounds,
        roadIds: scene.roads.filter((item) => contains(item.bounds, center)).map((item) => item.id),
        regionIds: regions.filter((item) => contains(item.bounds, center)).map((item) => item.id),
      };
    }),
  );
}
function area(cells: readonly Cell[]): number {
  return cells.reduce((sum, cell) => sum + cell.bounds.width * cell.bounds.height, 0);
}
function report(
  cells: readonly Cell[],
  roadId: string,
): PrototypeRoadCoverage['perRoad'][number] {
  const owned = cells.filter((cell) => cell.roadIds.includes(roadId));
  return {
    roadId,
    area: area(owned),
    uncoveredArea: area(owned.filter((cell) => cell.regionIds.length === 0)),
    regionIds: [...new Set(owned.flatMap((cell) => cell.regionIds))],
  };
}
/** Exact rectangular-union accounting for the supplied scene, not random sampling.
 * Report gaps/overlaps instead of silently accepting them; caller retains the scene and corrects the layout.
 */
export function auditRoadCoverage(scene: RoadPrototypeScene): PrototypeRoadCoverage {
  const all = cells(scene),
    roads = all.filter((cell) => cell.roadIds.length > 0);
  return {
    roadArea: area(roads),
    coveredArea: area(roads.filter((cell) => cell.regionIds.length > 0)),
    uncoveredArea: area(roads.filter((cell) => cell.regionIds.length === 0)),
    multiplyOwnedArea: area(roads.filter((cell) => cell.regionIds.length > 1)),
    outsideRoadArea: area(
      all.filter((cell) => cell.roadIds.length === 0 && cell.regionIds.length > 0),
    ),
    perRoad: scene.roads.map((road) => report(all, road.id)),
  };
}
