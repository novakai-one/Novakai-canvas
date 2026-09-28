/*
 * The vocabulary settling passes between its steps: local geometry, the drop being settled,
 * and the growth a group needs. Pure.
 */
import type { Placement, Section } from '../../../../contract/records/owners.js';
import type { SceneNode } from '../scene.js';

/** A point in group-local coordinates. */
export type Point = { readonly x: number; readonly y: number };

/** A size in group-local coordinates. */
export type Size = { readonly width: number; readonly height: number };

/** A measured rectangle: x, y, width and height. */
export type Box = Point & Size;

/** The dropped node, its appearance and its target placement. */
export interface Drop {
  readonly node: SceneNode;
  readonly moved: Section['appearances'][number];
  readonly after: Placement;
}

/** The drag path of a drop and the space its siblings leave. */
export interface DropGeometry {
  /** The drop point at fraction t of the path from the node's origin to its target. */
  readonly at: (t: number) => Point;
  /** Whether the point at t keeps a padding-wide gap from every sibling. */
  readonly clear: (t: number) => boolean;
  /** Whether the point p keeps a padding-wide gap from every sibling. */
  readonly free: (p: Point) => boolean;
  /** True when the node enters another group: it has no path inside it. */
  readonly entersGroup: boolean;
}

/** How far a group grows up and left, and the inset its children stay inside. */
export interface Growth {
  readonly dx: number;
  readonly dy: number;
  readonly insetX: number;
  readonly insetY: number;
}

/** The groups and appearances of a section being grown, step by step. */
export interface GrowthState {
  readonly groups: Section['groups'];
  readonly appearances: Section['appearances'];
}
