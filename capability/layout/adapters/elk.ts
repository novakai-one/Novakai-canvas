import { nativeEngineVersions } from '../contract/records/engines.js';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
import type { PlacementPort } from '../contract/ports/placement.js';
import type {
  PlacementProblem,
  PlacementNode,
  PlacementValue,
} from '../contract/records/problem.js';
import { failure } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
/** Default bundled ELK creates no background worker; a host's outer worker owns cancellation/lifetime. */
export interface NativePlacement {
  layout(graph: ElkNode): Promise<ElkNode>;
}
/** Creates one isolated native engine per place invocation; the host owns worker lifetime and cancellation. */
export type PlacementFactory = () => NativePlacement;
const directions = { right: 'RIGHT', down: 'DOWN', left: 'LEFT', up: 'UP' };
const algorithms = { layered: 'layered', tree: 'layered' };
const layerConstraints = { first: 'FIRST', last: 'LAST' };
/** Job-local mutable native graph is built from readonly capability data. */
function node(
  item: PlacementNode,
  problem: PlacementProblem,
): ElkNode {
  return {
    id: item.id,
    width: item.width,
    height: item.height,
    children: problem.nodes
      .filter((child) => child.parent === item.id)
      .map((child) => node(child, problem)),
    layoutOptions: {
      'elk.padding': `[top=${item.header + problem.padding},left=${problem.padding},bottom=${problem.padding},right=${problem.padding}]`,
      ...(item.layer === undefined
        ? {}
        : { 'elk.layered.layering.layerConstraint': layerConstraints[item.layer] }),
    },
  };
}
/** Stable edge IDs and endpoints retain semantic identity through native placement. */
function edge(item: PlacementProblem['edges'][number]): ElkExtendedEdge {
  return { id: item.id, sources: [item.source], targets: [item.target] };
}
/** Native options are implementation details; consumers supply only owned layout intent. */
function graph(problem: PlacementProblem): ElkNode {
  return {
    id: 'layout-scope',
    layoutOptions: {
      'elk.algorithm': algorithms[problem.algorithm],
      'elk.direction': directions[problem.direction],
      'elk.spacing.nodeNode': String(problem.spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(problem.layerSpacing),
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      // A wire back to an earlier authored node is the loop-back, not the forward path.
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.randomSeed': '1',
    },
    children: problem.nodes
      .filter((item) => item.parent === null)
      .map((item) => node(item, problem)),
    edges: problem.edges.map(edge),
  };
}
/** Missing native geometry is failure, never zero-valued fabricated placement. */
function coordinate(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    throw new Error('Native placement omitted geometry');
  return value;
}
/** Compound native positions are converted to the section-local coordinate frame. */
function flatten(
  node: ElkNode,
  x: number,
  y: number,
): readonly PlacementValue[] {
  const left = x + coordinate(node.x);
  const top = y + coordinate(node.y);
  const placed = {
    id: node.id,
    box: { x: left, y: top, width: coordinate(node.width), height: coordinate(node.height) },
  };
  return [placed, ...(node.children ?? []).flatMap((child) => flatten(child, left, top))];
}
/** Native implementation is isolated per invocation; no cached job or previous graph is mutated. */
export function createPlacement(native: PlacementFactory = () => new ELK.default()): PlacementPort {
  return {
    version: nativeEngineVersions.placement,
    async place(problem: PlacementProblem): Promise<Result<readonly PlacementValue[]>> {
      try {
        const engine = native();
        const result = await engine.layout(graph(problem));
        return {
          ok: true,
          value: (result.children ?? []).flatMap((child) => flatten(child, 0, 0)),
        };
      } catch {
        return failure('engine-failed', 'placement', 'Native placement failed');
      }
    },
  };
}
