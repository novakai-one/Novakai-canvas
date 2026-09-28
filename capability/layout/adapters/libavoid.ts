import { nativeEngineVersions } from '../contract/records/engines.js';
import type { RoutingPort } from '../contract/ports/routing.js';
import type {
  RoutingProblem,
  RouteValue,
  Connection,
  Obstacle,
} from '../contract/records/problem.js';
import type { Point } from '../contract/records/geometry.js';
import type { Result } from '../contract/errors.js';
import { failure } from '../contract/errors.js';
/** Narrow runtime ABI corrects stale upstream typings; none of these handles leave the adapter. */
interface Handle {
  delete(): void;
}
interface NativePoint extends Handle {
  readonly x: number;
  readonly y: number;
}
interface NativePath extends Handle {
  size(): number;
  at(index: number): NativePoint;
}
interface NativeConnection {
  setRoutingType(type: unknown): void;
  setRoutingCheckpoints(points: NativeCheckpoints): void;
  displayRoute(): NativePath;
  hasValidRoute(): boolean;
}
interface NativeRouter extends Handle {
  processTransaction(): void;
  setRoutingParameter(
    parameter: unknown,
    value: number,
  ): void;
}
interface NativeCheckpoints extends Handle {
  push_back(checkpoint: Handle): void;
}
interface NativeApi {
  readonly Router: new (flags: number) => NativeRouter;
  readonly Point: new (x: number, y: number) => NativePoint;
  readonly Rectangle: new (a: NativePoint, b: NativePoint) => Handle;
  readonly ShapeRef: new (router: NativeRouter, rectangle: Handle) => unknown;
  readonly ConnEnd: new (point: NativePoint) => Handle;
  readonly ConnRef: new (router: NativeRouter, source: Handle, target: Handle) => NativeConnection;
  readonly Checkpoint: new (point: NativePoint) => Handle;
  readonly CheckpointVector: new () => NativeCheckpoints;
  readonly RouterFlag: { readonly OrthogonalRouting: { readonly value: number } };
  readonly ConnType: { readonly ConnType_Orthogonal: unknown };
  readonly RoutingParameter: { readonly shapeBufferDistance: unknown };
}
/** Host supplies the pinned, separately served Wasm module; loader failures remain typed at composition. */
export type WasmLoader = () => Promise<unknown>;
const constructors = [
  'Router',
  'Point',
  'Rectangle',
  'ShapeRef',
  'ConnEnd',
  'ConnRef',
  'Checkpoint',
  'CheckpointVector',
];
/** Check the native constructor/enum boundary before calling a version-pinned external ABI. */
function isNative(value: unknown): value is NativeApi {
  if (value === null || typeof value !== 'object') return false;
  return (
    constructors.every((name): boolean => typeof Reflect.get(value, name) === 'function') &&
    hasEnums(value)
  );
}
/** Embind exposes enums as value objects, unlike the obsolete top-level numeric declarations. */
function hasEnums(value: object): boolean {
  const flags: unknown = Reflect.get(value, 'RouterFlag');
  if (!objectLike(flags)) return false;
  return (
    hasRouterFlag(flags) &&
    hasMember(value, 'ConnType', 'ConnType_Orthogonal') &&
    hasMember(value, 'RoutingParameter', 'shapeBufferDistance')
  );
}
/** Required numeric flag is checked separately to keep external-object traversal explicit. */
function hasRouterFlag(flags: object): boolean {
  const flag: unknown = Reflect.get(flags, 'OrthogonalRouting');
  if (flag === null || typeof flag !== 'object') return false;
  return typeof Reflect.get(flag, 'value') === 'number';
}
/** Embind enum namespaces are constructor functions with static members, not plain records. */
function objectLike(value: unknown): value is object {
  return typeof value === 'function' || (value !== null && typeof value === 'object');
}
/** Native enum identity is opaque; only presence is needed to pass it back to its own library. */
function hasMember(
  value: object,
  owner: string,
  key: string,
): boolean {
  const record: unknown = Reflect.get(value, owner);
  if (!objectLike(record)) return false;
  return Reflect.has(record, key);
}
/** Job-local native allocations are tracked in construction order for reverse cleanup, including failures. */
function own<T extends Handle>(
  handles: Handle[],
  handle: T,
): T {
  handles.push(handle);
  return handle;
}
/** Convert a plain owned coordinate into a temporary native point with explicit lifetime. */
function point(
  value: Point,
  native: NativeApi,
  handles: Handle[],
): NativePoint {
  return own(handles, new native.Point(value.x, value.y));
}
/** Router owns registered shapes; only temporary polygon/point handles are explicitly tracked. */
function obstacle(
  item: Obstacle,
  router: NativeRouter,
  native: NativeApi,
  handles: Handle[],
): void {
  const a = point(item.box, native, handles);
  const b = point(
    { x: item.box.x + item.box.width, y: item.box.y + item.box.height },
    native,
    handles,
  );
  const rectangle = own(handles, new native.Rectangle(a, b));
  new native.ShapeRef(router, rectangle);
}
/** Authored routing checkpoints are copied by libavoid; temporary vectors are released with the job. */
function checkpoints(
  points: readonly Point[],
  native: NativeApi,
  handles: Handle[],
): NativeCheckpoints {
  const vector = own(handles, new native.CheckpointVector());
  points.forEach((value): void => {
    const nativePoint = point(value, native, handles);
    const checkpoint = own(handles, new native.Checkpoint(nativePoint));
    vector.push_back(checkpoint);
  });
  return vector;
}
/** Route between explicit approach points; endpoint stubs and independent inspection enforce exact marker direction. */
function connection(
  item: Connection,
  router: NativeRouter,
  native: NativeApi,
  handles: Handle[],
): NativeConnection {
  const source = own(
    handles,
    new native.ConnEnd(point(item.sourceApproach ?? item.source, native, handles)),
  );
  const target = own(
    handles,
    new native.ConnEnd(point(item.targetApproach ?? item.target, native, handles)),
  );
  const connection = new native.ConnRef(router, source, target);
  connection.setRoutingType(native.ConnType.ConnType_Orthogonal);
  connection.setRoutingCheckpoints(checkpoints(item.checkpoints, native, handles));
  return connection;
}
/** Copy each native point before deleting its temporary wrapper; no native memory is returned. */
function readPoint(
  path: NativePath,
  index: number,
): Point {
  const native = path.at(index);
  try {
    return { x: native.x, y: native.y };
  } finally {
    native.delete();
  }
}
/** Invalid native routes fail visibly; their coordinates never escape as partial success. */
function readRoute(
  item: Connection,
  connection: NativeConnection,
): Result<RouteValue> {
  if (!connection.hasValidRoute())
    return failure('candidate-infeasible', item.id, 'Native candidate has no valid route', [
      item.id,
    ]);
  const path = connection.displayRoute();
  try {
    return {
      ok: true,
      value: {
        id: item.id,
        points: endpointStubs(
          item,
          Array.from({ length: path.size() }, (_, index): Point => readPoint(path, index)),
        ),
      },
    };
  } finally {
    path.delete();
  }
}
/** Explicit endpoint stubs enforce marker direction without relying on an unsupported directed ConnEnd ABI. */
function endpointStubs(
  item: Connection,
  points: readonly Point[],
): readonly Point[] {
  const source = item.sourceApproach === undefined ? [] : [item.source];
  const target = item.targetApproach === undefined ? [] : [item.target];
  return [...source, ...points, ...target];
}
/** All native state is per-call. Router deletion releases its owned shapes/connectors after temporaries. */
function route(
  problem: RoutingProblem,
  native: NativeApi,
): Result<readonly RouteValue[]> {
  const handles: Handle[] = [];
  const router = own(handles, new native.Router(native.RouterFlag.OrthogonalRouting.value));
  try {
    router.setRoutingParameter(native.RoutingParameter.shapeBufferDistance, problem.clearance);
    problem.obstacles.forEach((item): void => obstacle(item, router, native, handles));
    const routes = problem.connections.map(
      (item): { readonly item: Connection; readonly native: NativeConnection } => ({
        item,
        native: connection(item, router, native, handles),
      }),
    );
    router.processTransaction();
    return routes.reduce<Result<readonly RouteValue[]>>(
      (result, item): Result<readonly RouteValue[]> => {
        if (!result.ok) return result;
        return appendRoute(result.value, readRoute(item.item, item.native));
      },
      { ok: true, value: [] },
    );
  } finally {
    disposeAll(handles);
  }
}
/** Preserve candidate infeasibility without exposing an optimistic prefix; Layout owns bounded retry. */
function appendRoute(
  values: readonly RouteValue[],
  next: Result<RouteValue>,
): Result<readonly RouteValue[]> {
  if (!next.ok) return next;
  return { ok: true, value: [...values, next.value] };
}
/** Cleanup attempts every owned allocation even when one native destructor fails. */
function disposeAll(handles: readonly Handle[]): void {
  const disposed = handles.toReversed().map(dispose);
  if (disposed.some((success): boolean => !success))
    throw new Error('Native allocation cleanup failed');
}
/** One destructor failure is recorded without preventing later handles, including the router, from being freed. */
function dispose(handle: Handle): boolean {
  try {
    handle.delete();
    return true;
  } catch {
    return false;
  }
}
/** Native throws become typed failures; Layout retains prior geometry and owns independent route inspection. */
function protectedRoute(
  problem: RoutingProblem,
  native: NativeApi,
): Result<readonly RouteValue[]> {
  try {
    return route(problem, native);
  } catch {
    return failure('engine-failed', 'routing', 'Native obstacle routing failed');
  }
}
/** Load once, allocate router state per job. Host controls module/worker lifetime and restore/retry. */
export async function createRouting(load: WasmLoader): Promise<Result<RoutingPort>> {
  try {
    const native = await load();
    if (!isNative(native))
      return failure('engine-failed', 'routing', 'Pinned routing module ABI is unsupported');
    return {
      ok: true,
      value: {
        version: nativeEngineVersions.routing,
        route: async (problem): Promise<Result<readonly RouteValue[]>> =>
          protectedRoute(problem, native),
      },
    };
  } catch {
    return failure('engine-failed', 'routing', 'Pinned Wasm module could not be loaded');
  }
}
