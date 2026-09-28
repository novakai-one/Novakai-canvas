/*
 * The render job and the document it produces. Declarations only; core/rendering builds jobs, the
 * render worker produces documents, and the browser admits a document before opening Canvas. A
 * failed job keeps the caller's last accepted scene; Authoring owns admission and retry.
 */
import type { Collection } from '@novakai/canvas-model';
import type { FontSet, Projection, ResolvedStyle, VisualAsset } from '@novakai/canvas-presentation';
import type { Scene, LayoutOptions, SupplementalMeasurements } from '@novakai/canvas-layout';
import type { HostPath, RenderJobId } from '../../brands.js';

/**
 * Why a job runs, which names it: `read` renders a committed collection, `admission` renders a
 * candidate for Authoring's feasibility check, and `headless` renders for the CLI.
 */
export type RenderPurpose = 'read' | 'admission' | 'headless';

/** Admitted resources are detached into a worker request; the renderer has no persistence or Authoring authority. */
export interface RenderingJob {
  readonly id: RenderJobId;
  readonly collection: Collection;
  readonly fonts: FontSet;
  readonly style: ResolvedStyle;
  readonly assets: readonly VisualAsset[];
  readonly options: LayoutOptions;
  readonly wasmResource: HostPath;
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
