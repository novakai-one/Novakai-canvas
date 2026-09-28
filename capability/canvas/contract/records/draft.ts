import type { GestureId } from '../brands.js';
import type { Target, WireTarget } from './selection.js';
import type { Box, Point } from './camera.js';
import type { SceneStamp, RoutedWire } from './scene.js';
export interface GeometryEntry {
  readonly target: Target;
  readonly box: Box;
  readonly locked: boolean;
}
export interface PlacementDraft {
  readonly kind: 'move' | 'resize';
  readonly id: GestureId;
  readonly generation: number;
  readonly base: SceneStamp;
  readonly original: readonly GeometryEntry[];
  readonly current: readonly GeometryEntry[];
  readonly changed: boolean;
}
export type AttachmentSide = 'preserve' | 'auto' | 'top' | 'right' | 'bottom' | 'left';
export interface RouteGeometry {
  readonly points: readonly Point[];
  readonly sourceSide: AttachmentSide;
  readonly targetSide: AttachmentSide;
  readonly locked: boolean | 'preserve';
}
export interface RouteDraft {
  readonly kind: 'route';
  readonly id: GestureId;
  readonly generation: number;
  readonly base: SceneStamp;
  readonly target: WireTarget;
  readonly original: RouteGeometry;
  readonly current: RouteGeometry;
  readonly changed: boolean;
}
export type GestureDraft = PlacementDraft | RouteDraft;
export interface RecoverableDraft {
  readonly draft: GestureDraft;
  readonly reason: 'submitted' | 'scene-changed' | 'target-removed' | 'rejected' | 'disconnected';
  readonly message: string;
}

/** Ephemeral routing output for one pending gesture, never a replacement authoritative scene. */
export interface WireRoutePreview {
  readonly section: string;
  readonly source: RoutedWire['source'];
  readonly target: RoutedWire['target'];
  readonly id: string;
  readonly points: readonly Point[];
  readonly labelBox: Box;
}

/** Fully inspected release geometry is ephemeral; only placement intent crosses Authoring. */
export interface GeometryPreview {
  readonly bounds: Box;
  readonly wires: readonly WireRoutePreview[];
  readonly boxes: readonly { readonly target: Target; readonly box: Box }[];
  readonly sections: readonly { readonly id: string; readonly origin: Point }[];
}
