/*
 * Why this file exists
 *
 * To draw a collection, the render worker needs everything up front, because it can't read the
 * workspace. For example, to draw `my-diagram` it needs the collection, its theme's fonts and
 * style, its images and the layout options. That bundle is a `RenderingJob`.
 *
 * The worker answers with a `RenderDocument`: the laid-out scene plus the inputs it was made from,
 * so the browser can check the scene before showing it. This file declares both, and why a job
 * runs (`RenderPurpose`). Declarations only.
 */
import type { Collection } from '@novakai/canvas-model';
import type { FontSet, Projection, ResolvedStyle, VisualAsset } from '@novakai/canvas-presentation';
import type { Scene, LayoutOptions, SupplementalMeasurements } from '@novakai/canvas-layout';
import type { HostPath, RenderJobId } from '../../brands.js';

/**
 * Why a job runs; its ID starts with this. `read` draws a saved collection, `change-check` a change
 * not yet saved (to check it can be laid out), `headless` a diagram for the CLI with no service.
 */
export type RenderPurpose = 'read' | 'change-check' | 'headless';

/**
 * Everything the render worker needs to draw one collection. The worker can't read or save the
 * workspace; it gets only this.
 */
export interface RenderingJob {
  readonly id: RenderJobId;
  readonly collection: Collection;
  readonly fonts: FontSet;
  readonly style: ResolvedStyle;
  /** The collection's images. */
  readonly assets: readonly VisualAsset[];
  readonly options: LayoutOptions;
  /** The path of libavoid's WebAssembly file (libavoid routes the wires). */
  readonly wasmResource: HostPath;
}

/**
 * A drawn collection: the laid-out scene, and the inputs it was made from, so the browser can check
 * the scene itself before it shows it.
 */
export interface RenderDocument {
  readonly collection: Collection;
  readonly projection: Projection;
  readonly measurements: SupplementalMeasurements;
  readonly options: LayoutOptions;
  readonly scene: Scene;
  readonly fonts: FontSet;
  readonly style: ResolvedStyle;
}
