import type { VisualWire } from '../../contract/records/input.js';
import type { PlacedNode, Point, Box } from '../../contract/records/geometry.js';
import { point } from '../../contract/records/geometry.js';
import type { Connection, RouteValue, Obstacle } from '../../contract/records/problem.js';
import type { SupplementalMeasurements } from '../../contract/types.js';
import type { RoutingContext } from '../../contract/types.js';
import type { Result } from '../../contract/errors.js';
import type { Attachments } from './endpoints.js';
import { approach, endpoints, visible, departureSpace } from './endpoints.js';
import { validRoute } from './checks.js';
import { union } from '../geometry/bounds.js';
import { samePoint } from '../geometry/intersections.js';
import { reject, requireValue } from '../validation/outcomes.js';
export interface RoutePlan {
  readonly wire: VisualWire;
  readonly attachments: Attachments;
  readonly connection: Connection;
  readonly manual: readonly Point[] | null;
  readonly clearance: number;
}
/** Plan exact attachments and distinct local approaches. Public Layout execute catches faults; Authoring retains the scene and owns correction. */
export function plan(
  wire: VisualWire,
  nodes: readonly PlacedNode[],
  metrics: SupplementalMeasurements,
  context: RoutingContext,
  parallel: number,
  ordinal: number,
  siblings: readonly VisualWire[],
): RoutePlan {
  const resolved = endpoints(wire, nodes, siblings);
  const clearance = context.options.routeClearance * 2;
  const departure = clearance * (parallel + 1);
  const sourceSpace = departureSpace(resolved.source, nodes);
  const targetSpace = departureSpace(resolved.target, nodes);
  const sourceDistance = departureDistance(
    wire.id,
    metrics.markers[wire.sourceMarker].advance,
    departure,
    sourceSpace,
    ordinal,
  );
  const targetDistance = departureDistance(
    wire.id,
    metrics.markers[wire.targetMarker].advance,
    departure,
    targetSpace,
    ordinal,
  );
  const source = approach(resolved.source, sourceDistance);
  const target = approach(resolved.target, targetDistance);
  return {
    wire,
    attachments: resolved,
    manual: wire.route.manual ?? null,
    clearance: Math.min(
      context.options.routeClearance,
      sourceSpace - sourceDistance,
      targetSpace - targetDistance,
    ),
    connection: {
      id: wire.id,
      source: resolved.source.point,
      target: resolved.target.point,
      sourceSide: resolved.source.side,
      targetSide: resolved.target.side,
      sourceApproach: source,
      targetApproach: target,
      checkpoints: parallelCheckpoints(
        source,
        target,
        resolved.source.side,
        [visible(wire.source.node, nodes), visible(wire.target.node, nodes)],
        parallel,
        clearance,
        wire.labelVisible === false ? 0 : wire.label.height,
      ),
    },
  };
}
/** Stable source-order ordinals shorten optional clearance to keep coincident approaches distinct; required marker advance and the free-ray limit remain intact. */
function departureDistance(
  id: string,
  advance: number,
  preferred: number,
  space: number,
  ordinal: number,
): number {
  if (advance > space)
    return reject(
      'constraint-conflict',
      id,
      'Required endpoint marker approach is blocked by fixed content',
      [id],
    );
  const available = Math.max(0, Math.min(preferred, space / 3 - advance));
  return advance + available / (ordinal + 1);
}
/** Parallel wires reserve distinct outside lanes while keeping the same exact semantic endpoints. */
function parallelCheckpoints(
  source: Point,
  target: Point,
  side: Connection['sourceSide'],
  nodes: readonly PlacedNode[],
  parallel: number,
  gap: number,
  labelHeight: number,
): readonly Point[] {
  if (parallel === 0) return [source, target];
  const bounds = union(nodes.map((node): Box => node.box));
  const distance = (parallel + 1) * (gap + labelHeight);
  return laneCheckpoints(source, target, side, bounds, distance);
}
/** Parallel return lanes follow the actors' displacement; attachment side selects the outward boundary.
 * A horizontal row with top/bottom ports needs a horizontal lane, not an out-and-back excursion to the left.
 */
function laneCheckpoints(
  source: Point,
  target: Point,
  side: Connection['sourceSide'],
  bounds: Box,
  distance: number,
): readonly Point[] {
  if (Math.abs(target.x - source.x) >= Math.abs(target.y - source.y)) {
    const y = horizontalLane(side, bounds, distance);
    return [source, { x: source.x, y }, { x: target.x, y }, target];
  }
  const x = verticalLane(side, bounds, distance);
  return [source, { x, y: source.y }, { x, y: target.y }, target];
}
/** Bottom departures stay below the row; other horizontal lanes use its upper boundary. */
function horizontalLane(
  side: Connection['sourceSide'],
  bounds: Box,
  distance: number,
): number {
  if (side === 'bottom') return bounds.y + bounds.height + distance;
  return bounds.y - distance;
}
/** Right departures stay beyond the column; other vertical lanes use its left boundary. */
function verticalLane(
  side: Connection['sourceSide'],
  bounds: Box,
  distance: number,
): number {
  if (side === 'right') return bounds.x + bounds.width + distance;
  return bounds.x - distance;
}
/** Retain valid authored points. Public Layout execute catches lock faults; Authoring retains the scene and owns correction. */
export function manual(
  plan: RoutePlan,
  obstacles: readonly Obstacle[],
  metrics: SupplementalMeasurements,
): RouteValue | null {
  if (plan.manual === null) return null;
  const valid = validRoute(
    plan.manual,
    plan.attachments.source,
    plan.attachments.target,
    obstacles.map((item): Box => item.box),
    plan.wire,
    metrics,
  );
  if (valid) return { id: plan.wire.id, points: plan.manual };
  return invalidManual(plan);
}
/** Soft invalid geometry requests native rerouting; a hard lock instead produces a named conflict. */
function invalidManual(plan: RoutePlan): RouteValue | null {
  if (plan.wire.route.locked)
    return reject(
      'constraint-conflict',
      plan.wire.id,
      'Locked manual route no longer matches ports or clear content',
      [plan.wire.id],
    );
  return null;
}
/** Remove only consecutive duplicate points from native output; authored manual vertices are untouched. */
function checkedRoute(value: RouteValue): RouteValue {
  value.points.forEach(checkPoint);
  return {
    ...value,
    points: value.points.filter((item, index): boolean => distinct(item, value.points[index - 1])),
  };
}
/** A missing predecessor identifies the first native point. */
function distinct(
  point: Point,
  previous: Point | undefined,
): boolean {
  if (previous === undefined) return true;
  return !samePoint(point, previous);
}
/** Native nonfinite/oversized coordinates cannot reach path generation. */
function checkPoint(value: Point): void {
  if (!point.safeParse(value).success)
    reject('engine-failed', 'routing', 'Native route contains invalid coordinates');
}
/** Owned search outcome; only geometric infeasibility is retryable inside the candidate budget. */
export type NativeRouteOutcome =
  | { readonly kind: 'candidate-infeasible' }
  | { readonly kind: 'routed'; readonly routes: readonly RouteValue[] };
/** Native failures remain typed until the protected Layout boundary; cancellation wins even after an infeasible result. Public Layout execute catches faults; Authoring retains the scene and owns correction. */
export async function routeNative(
  connections: readonly Connection[],
  obstacles: readonly Obstacle[],
  context: RoutingContext,
): Promise<NativeRouteOutcome> {
  requireValue(await context.dependencies.jobs.checkpoint(context.job));
  const result = await context.dependencies.routing.route({
    connections,
    obstacles,
    clearance: context.options.routeClearance,
  });
  requireValue(await context.dependencies.jobs.checkpoint(context.job));
  return checkedOutcome(connections, result);
}
/** Skip only the owned geometric failure; requireValue preserves operational diagnostics for public execute. */
function checkedOutcome(
  connections: readonly Connection[],
  result: Result<readonly RouteValue[]>,
): NativeRouteOutcome {
  if (!result.ok && result.error.code === 'candidate-infeasible')
    return { kind: 'candidate-infeasible' };
  return { kind: 'routed', routes: checkedValues(connections, requireValue(result)) };
}
/** Exact identities and finite coordinates are operational requirements, never a reason to silently try another candidate. */
function checkedValues(
  connections: readonly Connection[],
  values: readonly RouteValue[],
): readonly RouteValue[] {
  const expected = connections.map((item): string => item.id).toSorted();
  const actual = values.map((item): string => item.id).toSorted();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    reject('engine-failed', 'routing', 'Native route set differs from requested connections');
  return values.map(checkedRoute);
}
