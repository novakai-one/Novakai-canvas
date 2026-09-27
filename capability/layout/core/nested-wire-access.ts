/*
 * Wire access records and the registry the wire router reads: a port's driveway onto its street
 * (`Access`), a node's entry or exit terminal (`Terminal`), a road crossing (`Crossing`) and the
 * `WireRegistry` holding them, which `nested-wire-registry.ts` builds once per scene. Pure: the
 * lookups below only read the registry and return `undefined` for an unknown key.
 */
import type {
  PrototypeBlock,
  PrototypeBounds,
  PrototypePoint,
  PrototypePortSide,
  PrototypeRoad,
} from '../contract/records/road-prototype.js';
export interface Access {
  readonly portId: string;
  readonly side: PrototypePortSide;
  readonly port: PrototypePoint;
  readonly mouth: PrototypePoint;
  readonly join: PrototypePoint;
  readonly roadId: string;
  readonly drive: PrototypeRoad;
}
export interface Terminal {
  readonly point: PrototypePoint;
  readonly accesses: readonly Access[];
}
export interface Crossing {
  readonly roadId: string;
  readonly at: number;
}
export interface WireRegistry {
  readonly roads: ReadonlyMap<string, PrototypeRoad>;
  readonly crossings: ReadonlyMap<string, readonly Crossing[]>;
  readonly accesses: ReadonlyMap<string, Access>;
  readonly terminals: ReadonlyMap<string, Terminal>;
  /** Node bodies a route must never cross; a moved node can sit on top of a road. */
  readonly bodies: readonly PrototypeBounds[];
}
export function center(block: PrototypeBlock): PrototypePoint {
  return {
    x: block.bounds.x + block.bounds.width / 2,
    y: block.bounds.y + block.bounds.height / 2,
  };
}

export function access(
  registry: WireRegistry,
  portId: string,
  owner: string | null,
): Access | undefined {
  return registry.accesses.get(`${portId}:${owner}`);
}
export function nodeTerminal(
  registry: WireRegistry,
  id: string,
  role: 'entry' | 'exit',
  portId?: string,
): Terminal | undefined {
  const terminal = registry.terminals.get(`${id}:${role}`);
  if (portId === undefined) return terminal;
  const selected = terminal?.accesses.find((entry) => entry.portId === portId);
  return selected === undefined ? undefined : gateTerminal(selected);
}
export function gateTerminal(value: Access): Terminal {
  return { point: value.port, accesses: [value] };
}
