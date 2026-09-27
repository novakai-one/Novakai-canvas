import type { Collection } from '@novakai/canvas-model';
import type { FontSet, Projection, ResolvedStyle, VisualAsset } from '@novakai/canvas-presentation';
import type { Scene, LayoutOptions, SupplementalMeasurements } from '@novakai/canvas-layout';
/** Admitted resources are detached into a worker request; the renderer has no persistence or Authoring authority. */
export interface RenderingJob {
  readonly id: string;
  readonly collection: Collection;
  readonly fonts: FontSet;
  readonly style: ResolvedStyle;
  readonly assets: readonly VisualAsset[];
  readonly options: LayoutOptions;
  /** Layout independently admits previous geometry as a preference, never as canonical content. */
  readonly previous: unknown;
  readonly wasmResource: string;
}
/** Browser receives enough owner input to independently admit serialized geometry before opening Canvas. */
export interface RenderDocument {
  readonly collection: Collection;
  readonly projection: Projection;
  readonly measurements: SupplementalMeasurements;
  readonly options: LayoutOptions;
  readonly scene: Scene;
  readonly fonts: FontSet;
  readonly style: ResolvedStyle;
}
