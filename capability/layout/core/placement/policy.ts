import type { Result } from '../../contract/errors.js';
/** Seed policy runs under Layout execute; structured native failures return to the caller, which retains the previous scene and retries. */
import type { LayoutIntent } from '../../contract/records/input.js';
import type {
  PlacementValue,
  PlacementNode,
  PlacementProblem,
} from '../../contract/records/problem.js';
import type { SeedContext, LayoutOptions } from '../../contract/types.js';
import { box } from '../../contract/records/geometry.js';
import { execute, reject, requireValue } from '../validation/outcomes.js';
import { gridPlacement } from './grid.js';
/** Immediate branch graph and independent local routing minima; wire-free scopes retain semantic gaps. */
export interface Scope {
  readonly nodes: readonly PlacementNode[];
  readonly edges: PlacementProblem['edges'];
  readonly layout: LayoutIntent;
  readonly minimumCrossSpacing: number;
  readonly minimumLayerSpacing: number;
}
/** Measured track sizes keep heterogeneous diagrams compact without allowing overlap. */
function grid(
  scope: Scope,
  options: LayoutOptions,
): readonly PlacementValue[] {
  const gap = options.gap[scope.layout.gap];
  const spacing = Math.max(gap, scope.minimumCrossSpacing);
  const layerSpacing = Math.max(gap, scope.minimumLayerSpacing);
  const columns = gridColumns(scope, options);
  return gridPlacement(
    scope.nodes,
    columns,
    spacing,
    layerSpacing,
    gridDirection(scope.layout),
    scope.layout.columns !== undefined,
  );
}
/** Sequence headers are horizontal; down/up describe time, not a column of overlapping lifelines. */
function gridDirection(layout: LayoutIntent): LayoutIntent['direction'] {
  if (layout.algorithm !== 'sequence') return layout.direction;
  return layout.direction === 'left' ? 'left' : 'right';
}
/** Placement engines provide seeds only; required constraints are applied afterward. */
async function native(
  scope: Scope,
  context: SeedContext,
): Promise<readonly PlacementValue[]> {
  const algorithm = scope.layout.algorithm === 'tree' ? 'tree' : 'layered';
  const gap = context.options.gap[scope.layout.gap];
  const spacing = Math.max(gap, scope.minimumCrossSpacing);
  const result = await context.dependencies.placement.place({
    ...scope,
    algorithm,
    direction: scope.layout.direction,
    spacing,
    layerSpacing: Math.max(gap, scope.minimumLayerSpacing),
    padding: context.options.padding,
  });
  return requireValue(result);
}
/** Native identity and geometry are checked before a seed can influence the solver. */
function checked(
  values: readonly PlacementValue[],
  scope: Scope,
): readonly PlacementValue[] {
  const expected = scope.nodes.map((node) => node.id).toSorted();
  const actual = values.map((node) => node.id).toSorted();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    reject('engine-failed', 'placement', 'Native placement returned a different node set');
  values.forEach(checkBox);
  return values;
}
/** Reject nonfinite/empty native geometry instead of coercing it to a default position. */
function checkBox(value: PlacementValue): void {
  if (!box.safeParse(value.box).success)
    reject('engine-failed', value.id, 'Native placement returned invalid bounds');
}
/** Cancellation is observed on both sides of native work and also for synchronous grid placement. Callers retain scene/draft and retry safely; Authoring owns commit recovery. */
export async function placeScope(
  scope: Scope,
  context: SeedContext,
): Promise<Result<readonly PlacementValue[]>> {
  return execute(async () => {
    requireValue(await context.dependencies.jobs.checkpoint(context.job));
    const values = await choose(scope, context);
    requireValue(await context.dependencies.jobs.checkpoint(context.job));
    return checked(values, scope);
  });
}
/** Closed layout policy selection keeps native dependencies out of geometry rules. */
async function choose(
  scope: Scope,
  context: SeedContext,
): Promise<readonly PlacementValue[]> {
  if (scope.layout.algorithm === 'grid' || scope.layout.algorithm === 'sequence')
    return grid(scope, context.options);
  return native(scope, context);
}

/** Omitted tracks retain legacy policy; validated explicit grid intent takes priority on every replay. */
function gridColumns(
  scope: Scope,
  options: LayoutOptions,
): number {
  if (scope.layout.algorithm === 'sequence') return Math.max(1, scope.nodes.length);
  return scope.layout.columns ?? options.gridColumns;
}
