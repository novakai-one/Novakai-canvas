import type { Box, PlacedSection } from '../../contract/records/geometry.js';
import type { Projection } from '../../contract/records/input.js';
import { overlaps } from '../geometry/intersections.js';

/** Saved section positions reserve space before unplaced sections choose a free grid position. */
export function availableSections(
  preferred: readonly PlacedSection[],
  projection: Projection,
  gap: number,
): readonly PlacedSection[] {
  const retained = new Set(projection.sections.filter((s) => s.placement != null).map((s) => s.id));
  const kept = pushApart(
    preferred.filter((s) => retained.has(s.id)),
    gap,
  );
  const occupied = [...kept.values()].map((s) => s.box);
  return preferred.map((section) => {
    const own = kept.get(section.id);
    if (own !== undefined) return own;
    const box = availableBox(section.box, occupied, gap);
    occupied.push(box);
    return {
      ...section,
      box,
      origin: { x: section.origin.x, y: section.origin.y + box.y - section.box.y },
    };
  });
}

/** Moving downward in bottom-edge order clears each obstacle once, without shifting its owner. */
function availableBox(
  preferred: Box,
  occupied: readonly Box[],
  gap: number,
): Box {
  return occupied
    .toSorted((a, b) => a.y + a.height - b.y - b.height)
    .reduce((box, obstacle) => {
      const clearance = {
        x: obstacle.x - gap,
        y: obstacle.y - gap,
        width: obstacle.width + gap * 2,
        height: obstacle.height + gap * 2,
      };
      return overlaps(box, clearance) ? { ...box, y: obstacle.y + obstacle.height + gap } : box;
    }, preferred);
}

/** A saved section that grew into a saved neighbour pushes it right (if it started to the right) or down.
 * Only overlapping neighbours move, by exactly the overlap plus the gap.
 */
function pushApart(
  sections: readonly PlacedSection[],
  gap: number,
): ReadonlyMap<string, PlacedSection> {
  const start = new Map(sections.map((s) => [s.id, s.box]));
  const order = sections.toSorted((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const placed = new Map(order.map((s) => [s.id, s]));
  for (let pass = 0; pass < order.length; pass++) {
    let changed = false;
    order.forEach((first, i) =>
      order.slice(i + 1).forEach((next) => {
        const a = placed.get(first.id)!.box,
          b = placed.get(next.id)!;
        const clearance = {
          x: a.x - gap,
          y: a.y - gap,
          width: a.width + gap * 2,
          height: a.height + gap * 2,
        };
        if (!overlaps(b.box, clearance)) return;
        const right = start.get(next.id)!.x >= start.get(first.id)!.x + start.get(first.id)!.width;
        const dx = right ? a.x + a.width + gap - b.box.x : 0,
          dy = right ? 0 : a.y + a.height + gap - b.box.y;
        if (dx <= 0 && dy <= 0) return;
        placed.set(next.id, {
          ...b,
          box: { ...b.box, x: b.box.x + dx, y: b.box.y + dy },
          origin: { x: b.origin.x + dx, y: b.origin.y + dy },
        });
        changed = true;
      }),
    );
    if (!changed) break;
  }
  return placed;
}
