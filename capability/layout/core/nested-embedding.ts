import { validateNestedEmbedding } from './nested-embedding-validation.js';
import type {
  NestedSupportRequest,
  NestedEmbeddingResult,
  NestedSupportLedger,
} from '../contract/records/nested-support.js';
import { compileNestedSupports, compileSupportInput } from './nested-support.js';
import { solveNestedEmbedding } from './nested-embedding-solve.js';
import { embedNestedBodies } from './nested-embedding-bodies.js';
import { embedNestedRoads } from './nested-embedding-roads.js';
import { embedNestedPlan } from './nested-embedding-plan.js';
import { roadNetwork } from './prototype-road-network.js';
import { bridgeSpanGrowth, expandedSupportLedger } from './nested-support-expansion.js';
import { projectNestedWires, readNestedProjectionSupports } from './nested-lane-projection.js';
import { SupportRejection, reject, required } from './nested-support-graph.js';
import type { retainSupportInput } from './nested-support-input.js';
type Input = ReturnType<typeof retainSupportInput>;

/** Materialize one admitted reservation with frozen choices. Not a scene-legality certificate.
 * Callers reconstruct after a typed rejection; unexpected programming errors propagate.
 */
export function embedNestedSupports(request: NestedSupportRequest): NestedEmbeddingResult {
  try {
    return embed(request);
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown): NestedEmbeddingResult {
  if (error instanceof SupportRejection) return { ok: false, error: error.evidence };
  throw error;
}
function embed(request: NestedSupportRequest): NestedEmbeddingResult {
  const { input, ledger } = compileNestedSupports(request);
  const prepared = materialize(input, request.scene, ledger);
  const network = roadNetwork(prepared.roads, prepared.contacts);
  const wires = projectNestedWires(
    prepared.wires,
    prepared.byWire,
    prepared.byId,
    network.junctions,
    prepared.scene.ports,
  );
  const scene = {
    ...prepared.scene,
    roads: prepared.roads,
    ...network,
    wireLanes: prepared.lanes,
    wiring: { ok: true as const, value: wires },
  };
  return {
    ok: true,
    value: { scene, ledger: prepared.ledger, moved: prepared.moved, roadIds: prepared.roadIds },
  };
}

/** The ordinary builder supplies its once-selected input and support-only observation.
 * No placement, routing, allocation, network or projection is repeated here.
 */
export function prepareNestedEmbedding(
  input: Input,
  scene: NestedSupportRequest['scene'],
) {
  return materialize(input, scene, compileSupportInput(input, scene));
}
function materialize(
  input: Input,
  scene: NestedSupportRequest['scene'],
  ledger: NestedSupportLedger,
) {
  const solution = solveNestedEmbedding(ledger);
  const prepared = materializeSolved(input, scene, ledger, solution);
  const growth = projectedGrowth(prepared);
  if (growth.length === 0) return prepared;
  const originals = new Map(prepared.roadIds.map((r) => [r.after, r.before]));
  const spans = growth.map((g) => ({ ...g, roadId: required(originals, g.roadId) }));
  const expanded = expandedSupportLedger(ledger, solution.values, spans);
  const resolved = solveNestedEmbedding(expanded);
  const result = materializeSolved(input, scene, expanded, { ...resolved, old: solution.old });
  const further = projectedGrowth(result);
  if (further.length > 0)
    reject(
      'unsupported-support',
      further.flatMap((g) => g.provenance),
      further.flatMap((g) => [g.negative, g.positive]),
    );
  return result;
}
function projectedGrowth(prepared: ReturnType<typeof materializeSolved>) {
  const supports = readNestedProjectionSupports(prepared.wires, prepared.byWire, prepared.byId);
  return bridgeSpanGrowth(supports, prepared.byId, prepared.contacts);
}
function materializeSolved(
  input: Input,
  scene: NestedSupportRequest['scene'],
  ledger: NestedSupportLedger,
  solution: ReturnType<typeof solveNestedEmbedding>,
) {
  const { values, old } = solution;
  const moved = [...values]
    .filter(([key, value]) => value !== required(old, key))
    .map(([key, position]) => ({ key, before: required(old, key), position }));
  if (moved.length === 0 && ledger.spanGrowth === undefined)
    return unchanged(input, scene, ledger, moved);
  const bodies = embedNestedBodies(scene, values);
  const roads = embedNestedRoads(scene.roads, input.contacts, ledger, values, old, bodies.ports);
  validateNestedEmbedding(roads.roads, roads.contacts);
  const plan = embedNestedPlan(input.wires, input.allocation.byWire, roads.byOldId, bodies.ports);
  return {
    scene: { ...scene, ...bodies },
    ...roads,
    ...plan,
    ledger,
    moved,
    lanes: input.allocation.lanes.map((lane) => ({
      ...lane,
      roadId: required(roads.byOldId, lane.roadId).id,
    })),
    roadIds: scene.roads.map((road) => ({
      before: road.id,
      after: required(roads.byOldId, road.id).id,
    })),
  };
}
function unchanged(
  input: Input,
  scene: NestedSupportRequest['scene'],
  ledger: NestedSupportLedger,
  moved: ReturnType<typeof solveNestedEmbedding>['moved'],
) {
  return {
    scene,
    ledger,
    moved,
    roads: scene.roads,
    byId: input.final,
    contacts: input.contacts.map((c) => ({
      a: required(input.final, c.a.id),
      b: required(input.final, c.b.id),
    })),
    wires: input.wires,
    byWire: input.allocation.byWire,
    lanes: input.allocation.lanes,
    roadIds: scene.roads.map((road) => ({ before: road.id, after: road.id })),
  };
}
