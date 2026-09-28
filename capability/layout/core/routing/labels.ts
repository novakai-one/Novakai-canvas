import type { Point, Box } from '../../contract/records/geometry.js';
import type { MeasuredContent } from '../../contract/records/input.js';
import type { Segment } from './paths.js';
import { segments } from './paths.js';
import { overlaps } from '../geometry/intersections.js';
import { expand } from '../geometry/bounds.js';
/** Route bounds extend one pixel right/down; positive-side candidates clear that same footprint. */
function atFraction(
  segment: Segment,
  content: MeasuredContent,
  gap: number,
  fraction: number,
): readonly Box[] {
  const x = segment.a.x + (segment.b.x - segment.a.x) * fraction;
  const y = segment.a.y + (segment.b.y - segment.a.y) * fraction;
  const width = content.width;
  const height = content.height;
  // pointBounds gives zero-width strokes a one-pixel right/bottom footprint.
  const positiveGap = gap + 1;
  if (segment.a.y === segment.b.y)
    return [
      { x: x - width / 2, y: y - gap - height, width, height },
      { x: x - width / 2, y: y + positiveGap, width, height },
    ];
  return [
    { x: x + positiveGap, y: y - height / 2, width, height },
    { x: x - gap - width, y: y - height / 2, width, height },
  ];
}
/** Midpoint is preferred; quarter positions allow labels to avoid crossing routes without becoming detached. */
export function candidates(
  segment: Segment,
  content: MeasuredContent,
  gap: number,
): readonly Box[] {
  const span = length(segment);
  const extent = segment.a.y === segment.b.y ? content.width : content.height;
  const inset = (extent / 2 + gap) / span;
  const steps = Math.max(1, Math.min(32, Math.floor(span / (extent + gap * 2))));
  const fractions = [
    0.5,
    0.25,
    0.75,
    // Flush against either end with the same measured clearance, without extending past a bend.
    ...(inset <= 0.5 ? [inset, 1 - inset] : []),
    ...Array.from({ length: steps }, (_, i) => (i + 0.5) / steps),
  ];
  return fractions.flatMap((fraction) => atFraction(segment, content, gap, fraction));
}
/** Search longest segments first so an engineering label reads with a substantial part of its wire. */
export function labelBox(
  points: readonly Point[],
  content: MeasuredContent,
  occupied: readonly Box[],
  gap: number,
  blocked: (box: Box) => boolean = () => false,
): Box | null {
  const ordered = labelSegments(points).toSorted((a, b) => length(b) - length(a));
  const boxes = ordered.flatMap((segment) => candidates(segment, content, gap));
  return (
    boxes.find(
      (candidate) =>
        !blocked(expand(candidate, gap)) &&
        occupied.every((box) => !overlaps(expand(candidate, gap), box)),
    ) ?? null
  );
}
/** Manhattan length is exact for the inspected orthogonal corridor. */
function length(segment: Segment): number {
  return Math.abs(segment.a.x - segment.b.x) + Math.abs(segment.a.y - segment.b.y);
}

/** A supplied candidate label must occupy one of the wire's actual adjacent segment positions. */
export function adjacentLabel(
  box: Box,
  points: readonly Point[],
  content: MeasuredContent,
  gap: number,
): boolean {
  return labelSegments(points)
    .flatMap((segment) => candidates(segment, content, gap))
    .some(
      (candidate) =>
        Math.abs(candidate.x - box.x) < 0.000001 && Math.abs(candidate.y - box.y) < 0.000001,
    );
}

/** Collinear native checkpoints split no painted line; allocate against its full straight run.
 * Authored vertices remain untouched. Pure replay has no recovery state; Layout owns rejection.
 */
function labelSegments(points: readonly Point[]): readonly Segment[] {
  return segments(points).reduce<readonly Segment[]>(extendRun, []);
}
/** Only forward collinear travel merges; bends and reversals retain their separate footprints. */
function extendRun(
  runs: readonly Segment[],
  next: Segment,
): readonly Segment[] {
  const previous = runs.at(-1);
  if (previous === undefined) return [next];
  if (!sameDirection(previous, next)) return [...runs, next];
  return [...runs.slice(0, -1), { a: previous.a, b: next.b }];
}
/** Signed unit directions distinguish a straight continuation from a retraced hairpin. */
function sameDirection(
  a: Segment,
  b: Segment,
): boolean {
  return (
    Math.sign(a.b.x - a.a.x) === Math.sign(b.b.x - b.a.x) &&
    Math.sign(a.b.y - a.a.y) === Math.sign(b.b.y - b.a.y)
  );
}
