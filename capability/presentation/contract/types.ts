import type { DomainReader } from './ports/domain.js';
import type { ThemeResolver, AssetReader } from './ports/resources.js';
import type { MeasurementPort } from './ports/measurement.js';
import type { RenderPort } from './ports/rendering.js';
import type { Result } from './errors.js';
import type { Projection, MeasuredContent, MarkerKind } from './records/visual.js';
import type { FontRef } from './records/style.js';
export interface Dependencies {
  readonly chromePolicies?: import('./records/chrome.js').ChromePolicies | undefined;
  readonly domain: DomainReader;
  readonly themes: ThemeResolver;
  readonly assets: AssetReader;
  readonly measurement: MeasurementPort;
  readonly renderer: RenderPort;
}
export interface TextRequest {
  readonly text: string;
  readonly width: number;
  readonly font: FontRef;
  readonly strong?: FontRef;
  readonly size: number;
  readonly lineHeight: number;
  readonly fill: string;
}
/** Pure read/render API; Authoring retains committed state when a preview fails. */
export interface Presentation {
  project(input: unknown): Result<Projection>;
  supplement(input: unknown): Result<SupplementalMeasurements>;
  measureText(request: TextRequest): Result<MeasuredContent>;
  renderContent(node: unknown): Result<string>;
  marker(
    kind: unknown,
    paint: unknown,
  ): Result<string>;
}

/** Extra notation metrics share the same pinned font and marker geometry as the ordinary projection. */
export interface SupplementalMeasurements {
  readonly version: string;
  readonly branchHeadings: readonly {
    readonly section: string;
    readonly fragment: string;
    readonly branch: string;
    readonly content: MeasuredContent;
  }[];
  readonly markers: Readonly<
    Record<MarkerKind, { readonly advance: number; readonly halfHeight: number }>
  >;
}
