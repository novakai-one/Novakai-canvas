import { z } from 'zod';
import { identity, type GestureId } from '../brands.js';
import type { Target, WireTarget } from './selection.js';
import type { SceneStamp } from './scene.js';
import type { Point } from './camera.js';
import type { RouteGeometry } from './draft.js';
export const endpoint = z
  .strictObject({ section: identity, node: identity, member: identity.nullable() })
  .readonly();
export type Endpoint = z.infer<typeof endpoint>;
interface IntentBase {
  readonly id: GestureId;
  readonly base: SceneStamp;
  readonly scope: 'appearance';
}
export interface LocalPlacement extends Point {
  readonly width?: number;
  readonly height?: number;
  readonly locked: boolean;
}
export interface PlacementIntent extends IntentBase {
  readonly kind: 'placement';
  readonly entries: readonly { readonly target: Target; readonly placement: LocalPlacement }[];
}
/** One node dropped into a different group (or out of all groups); placement is local to `into`. */
export interface RegroupIntent extends IntentBase {
  readonly kind: 'regroup';
  readonly target: Target;
  readonly into: Target;
  readonly placement: LocalPlacement;
}
export interface RouteIntent extends IntentBase {
  readonly kind: 'route';
  readonly target: WireTarget;
  readonly route: RouteGeometry;
}
export interface ConnectionIntent extends IntentBase {
  readonly kind: 'connection';
  readonly source: Endpoint;
  readonly target: Endpoint;
}
export interface SelectionIntent extends IntentBase {
  readonly kind: 'remove-appearances' | 'duplicate';
  readonly targets: readonly Target[];
}
export interface AlignmentIntent extends IntentBase {
  readonly kind: 'align';
  readonly targets: readonly Target[];
  readonly axis: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
}
export type EditIntent =
  | PlacementIntent
  | RegroupIntent
  | RouteIntent
  | ConnectionIntent
  | SelectionIntent
  | AlignmentIntent;
export type CanvasEffect =
  | { readonly kind: 'edit-intent'; readonly intent: EditIntent }
  | { readonly kind: 'inspect-request'; readonly target: Target }
  | { readonly kind: 'navigation-request'; readonly target: Target }
  | { readonly kind: 'announce'; readonly message: string }
  | { readonly kind: 'recover-draft'; readonly id: GestureId; readonly message: string };

/** Where a new object dropped on the canvas belongs: a section, and the group inside it (null = no group). */
export interface DropTarget {
  readonly section: string;
  readonly group: string | null;
}
