/*
 * Travel records: one wire's visit to one road (`Travel`), and that visit once lane allocation
 * has placed it (`AssignedTravel`). Types only; nothing here runs. A leaf file, so lane
 * ordering, allocation and projection share the records without importing each other.
 */
import type { NestedWireLane } from '../contract/records/nested-wires.js';
import type { PrototypeRoad } from '../contract/records/road-prototype.js';

/** One wire's visit to one road: segments `first`..`last`, moving +1 or -1 along the road's axis. */
export interface Travel {
  readonly road: PrototypeRoad;
  readonly wireId: string;
  readonly first: number;
  readonly last: number;
  readonly direction: 1 | -1;
}
/** A visit after lane allocation: its lane, fan position and pitch, and any transfer channel. */
export interface AssignedTravel extends Travel {
  readonly lane: NestedWireLane;
  readonly at: number;
  readonly count: number;
  readonly fanIndex: number;
  readonly fanCount: number;
  readonly pitch: number;
  readonly transfer?: TransferChannel;
}
/** Lane coordinates reserved on a crossing road where a wire shifts between two collinear visits. */
export interface TransferChannel {
  readonly roadId: string;
  readonly coordinates: readonly number[];
}
