import type { RoutingOverlay } from './routing-overlay.js';
import type { Box, Point, PlacedNode } from './geometry.js';
import type { PrototypeNodePort, PrototypeRoad } from './road-prototype.js';
export interface MeasuredBlock {
  readonly nodeId: string;
  readonly memberPorts: readonly PrototypeNodePort[];
  readonly bounds: Box;
}
export interface EngineWirePath {
  readonly wireId: string;
  readonly path: readonly Point[];
  readonly lanes: readonly string[];
}
export interface EngineScene {
  readonly routing?: RoutingOverlay | undefined;
  readonly frame: Box;
  readonly blocks: readonly MeasuredBlock[];
  readonly nodes: readonly PlacedNode[];
  readonly wires: readonly EngineWirePath[];
  readonly roads: readonly PrototypeRoad[];
}
