import { treeBranch } from '../routing/tree.js';
import type { VisualSection, VisualWire } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';
import type { PlacedNode, RoutedWire, Box } from '../../contract/records/geometry.js';
import type { LayoutOptions, SupplementalMeasurements } from '../../contract/types.js';
import { prepareLane, distinctPreparedLane } from '../routing/lanes.js';
import { endpoints } from '../routing/endpoints.js';
import { contentBoxes, labelObstacles } from '../routing/obstacles.js';
import { validRoute, checkLabel, markerBox } from '../routing/checks.js';
import { linePath, curvePath, segments } from '../routing/paths.js';
import type { Segment } from '../routing/paths.js';
import { adjacentLabel } from '../routing/labels.js';
import { segmentHits } from '../geometry/intersections.js';
import { sameIds, same } from './facts.js';
import { reject } from './outcomes.js';
interface Context {
  readonly nodes: readonly PlacedNode[];
  readonly options: LayoutOptions;
  readonly metrics: SupplementalMeasurements;
  readonly candidates: SectionCandidate['wires'];
  readonly lanes: ReadonlyMap<string, ReturnType<typeof prepareLane>>;
  readonly pairs: Map<string, Map<string, boolean>>;
  readonly branches: ReadonlySet<string>;
  /** After a human move in a module diagram, a wire may pass behind a node; notices warn. */
  readonly behind: boolean;
  /** Native-routed wires sharing a node side each own a point; module roads attach at the middle. */
  readonly siblings: readonly VisualWire[] | undefined;
}
/** Reconstruct only authoritative wire data after exact attachment/route/label validation. */
function rebind(
  wire: VisualWire,
  context: Context,
): RoutedWire {
  const candidate = context.candidates.find((item) => item.id === wire.id);
  if (!candidate) return reject('invalid-input', wire.id, 'Candidate wire is missing');
  const branch = treeBranch(wire, context.nodes);
  if (branch !== undefined) {
    same(branch, candidate, wire.id);
    return branch;
  }
  const attachments = endpoints(wire, context.nodes, context.siblings);
  same(attachments, { source: candidate.source, target: candidate.target }, wire.id);
  same(wire.label, candidate.measuredLabel, wire.id);
  same(wire.labelVisible, candidate.labelVisible, wire.id);
  same(wire.appearance, candidate.appearance, wire.id);
  same(
    [wire.sourceMarker, wire.targetMarker, wire.style],
    [candidate.sourceMarker, candidate.targetMarker, candidate.style],
    wire.id,
  );
  checkGeometry(wire, candidate, context);
  checkSharedRuns(candidate, context);
  return { ...candidate, ...attachments, measuredLabel: wire.label, appearance: wire.appearance };
}
/** Native output has no special authority: inspect the corridor, exact path syntax, manual lock and label independently. */
function checkGeometry(
  wire: VisualWire,
  candidate: SectionCandidate['wires'][number],
  context: Context,
): void {
  const obstacles = contentBoxes(context.nodes);
  if (
    !validRoute(
      candidate.points,
      candidate.source,
      candidate.target,
      context.behind ? [] : obstacles,
      wire,
      context.metrics,
    )
  )
    reject(
      'constraint-conflict',
      wire.id,
      'Candidate route violates a port, marker extent or content obstacle',
    );
  const path =
    wire.route.route === 'curve'
      ? curvePath(candidate.points, context.options.routeClearance / 2, [
          ...obstacles,
          ...context.candidates
            .filter((item) => item.labelVisible !== false)
            .map((item) => item.labelBox),
        ])
      : linePath(candidate.points);
  same(path, candidate.path, wire.id);
  checkManual(wire, candidate);
  checkLabels(wire, candidate, context);
}
/** Every authored point in a locked route remains part of the stored corridor. */
function checkManual(
  wire: VisualWire,
  candidate: SectionCandidate['wires'][number],
): void {
  if (!wire.route.locked) return;
  if (wire.route.manual !== undefined) same(wire.route.manual, candidate.points, wire.id);
}
/** Labels stay adjacent to a real segment and clear of content, other labels and both endpoint markers. */
function checkLabels(
  wire: VisualWire,
  candidate: SectionCandidate['wires'][number],
  context: Context,
): void {
  if (wire.labelVisible === false) {
    same(candidate.labelBox, { ...candidate.source.point, width: 0, height: 0 }, wire.id);
    return;
  }
  const others = context.candidates.filter((item) => item.id !== wire.id);
  const markers = context.candidates.flatMap((item) => markerBounds(item, context.metrics));
  const occupied = [
    ...labelObstacles(context.nodes),
    ...others.filter((item) => item.labelVisible !== false).map((item) => item.labelBox),
    ...markers,
  ];
  checkLabel(candidate.labelBox, wire, occupied);
  if (!adjacentLabel(candidate.labelBox, candidate.points, wire.label, context.options.labelGap))
    reject('constraint-conflict', wire.id, 'Wire has no label segment');
  others.forEach((other) =>
    checkLabelCrossing(
      wire.id,
      candidate.labelBox,
      context.lanes.get(other.id)?.segments ?? segments(other.points),
    ),
  );
}
/** Every candidate marker reserves its owner-supplied dimensions near the checked endpoint. */
function markerBounds(
  wire: SectionCandidate['wires'][number],
  metrics: SupplementalMeasurements,
): readonly Box[] {
  return [
    markerBox(wire.source, metrics.markers[wire.sourceMarker]),
    markerBox(wire.target, metrics.markers[wire.targetMarker]),
  ];
}
/** A later connection may cross another wire, but may never strike through its label. */
function checkLabelCrossing(
  id: string,
  box: Box,
  lines: readonly Segment[],
): void {
  if (lines.some((segment) => segmentHits(segment.a, segment.b, box)))
    reject('constraint-conflict', id, 'Another wire crosses this label');
}
/** Check wire cardinality and measured payloads before returning immutable rendering records.
 * Layout inspect protects structured failures; callers correct the candidate and Authoring retains committed state. */
export function inspectWires(
  source: VisualSection,
  candidates: SectionCandidate['wires'],
  nodes: readonly PlacedNode[],
  metrics: SupplementalMeasurements,
  options: LayoutOptions,
): readonly RoutedWire[] {
  sameIds(
    source.wires.map((wire) => wire.id),
    candidates.map((wire) => wire.id),
    source.id,
  );
  const context: Context = {
    candidates,
    branches: new Set(
      source.wires.filter((wire) => treeBranch(wire, nodes) !== undefined).map((wire) => wire.id),
    ),
    nodes,
    metrics,
    options,
    behind: source.mode === 'modules' && source.nodes.some((node) => node.placement !== null),
    siblings:
      source.mode === 'modules'
        ? undefined
        : source.wires.filter((wire) => treeBranch(wire, nodes) === undefined),
    lanes: new Map(candidates.map((wire) => [wire.id, prepareLane(wire.points)])),
    pairs: new Map(candidates.map((wire) => [wire.id, new Map()])),
  };
  return source.wires.map((wire) => rebind(wire, context));
}

/** Inspect final routes independently; an interior shared run hides which relationship reaches which endpoint. */
function checkSharedRuns(
  wire: SectionCandidate['wires'][number],
  context: Context,
): void {
  // After a human move, two wires may share a run rather than the move being refused.
  const others = context.behind
    ? []
    : context.candidates.filter((item) => item.id !== wire.id && !context.branches.has(item.id));
  const hidden = others.find((item) => !clearLanes(wire, item, context));
  if (hidden !== undefined)
    reject('constraint-conflict', wire.id, 'Wires share an obscuring interior route', [
      wire.id,
      hidden.id,
    ]);
}

/** Cache symmetric results lazily so the original inspection/failure order stays unchanged. */
function clearLanes(
  a: SectionCandidate['wires'][number],
  b: SectionCandidate['wires'][number],
  context: Context,
): boolean {
  const cached = context.pairs.get(a.id)?.get(b.id);
  if (cached !== undefined) return cached;
  const left = context.lanes.get(a.id) ?? prepareLane(a.points);
  const right = context.lanes.get(b.id) ?? prepareLane(b.points);
  const clear = distinctPreparedLane(left, right);
  context.pairs.get(a.id)?.set(b.id, clear);
  context.pairs.get(b.id)?.set(a.id, clear);
  return clear;
}
