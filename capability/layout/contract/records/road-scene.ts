/*
 * The road scene: everything the module-roads engine builds for one diagram (sections, nodes,
 * ports, roads, lanes, junctions) plus the optional wire and embedding results attached to it.
 * Types only; nothing here runs. Kept apart from the road primitives in `road-prototype.ts` so
 * the wire and support records can use those primitives without a cycle.
 */
import type { NestedSupportFailure } from './nested-support-failure.js';
import type { NestedWireResult, NestedWireLane } from './nested-wires.js';
import type {
  PrototypeBlock,
  PrototypeCrossingExample,
  PrototypeDivider,
  PrototypeJunction,
  PrototypeLane,
  PrototypeLaneConnection,
  PrototypeNode,
  PrototypePortLocation,
  PrototypeRoad,
} from './road-prototype.js';

/** One built scene. Wiring adds `wireLanes` and `wiring`; a refused embedding adds `embeddingFailure`. */
export interface RoadPrototypeScene {
  readonly embeddingFailure?: NestedSupportFailure;
  readonly wireLanes?: readonly NestedWireLane[];
  readonly wiring?: NestedWireResult;
  readonly sections: readonly PrototypeBlock[];
  readonly nodes: readonly PrototypeNode[];
  readonly ports: readonly PrototypePortLocation[];
  readonly roads: readonly PrototypeRoad[];
  readonly roadWidth: number;
  readonly drivewayWidth: number;
  readonly lanes: readonly PrototypeLane[];
  readonly junctions: readonly PrototypeJunction[];
  readonly dividers: readonly PrototypeDivider[];
  readonly connections: readonly PrototypeLaneConnection[];
  readonly crossingExamples: readonly PrototypeCrossingExample[];
}
