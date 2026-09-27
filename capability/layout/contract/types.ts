import type { LayoutInputKey } from './brands.js';
import { z } from 'zod';
import type { ProjectionReader } from './ports/projection.js';
import type { Result, Diagnostic } from './errors.js';
import type { Projection, MeasuredContent, MarkerKind, VisualSection } from './records/input.js';
import type { Scene, PlacedNode, PlacedSection } from './records/geometry.js';
import type { PrototypeLayoutMeasure } from './records/road-prototype.js';
import type { PlacementPort } from './ports/placement.js';
import type { SolverPort } from './ports/solver.js';
import type { RoutingPort } from './ports/routing.js';
import type { JobControl, Job } from './ports/scheduling.js';
const positive = z.number().finite().positive().max(10000);
/** Spacing comes from host-resolved tokens; no production UI palette or typography default is stored here. */
export const options = z
  .strictObject({
    gap: z.strictObject({ compact: positive, normal: positive, roomy: positive }).readonly(),
    padding: positive,
    routeClearance: positive,
    labelGap: positive,
    sequenceGap: positive,
    activationWidth: positive,
    gridColumns: z.number().int().min(1).max(100),
    maxBranches: z.number().int().min(1).max(4096),
  })
  .readonly();
export type LayoutOptions = z.infer<typeof options>;
/** Supplemental Presentation results cover metrics absent from canonical event/marker enums. */
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
export interface LayoutRequest {
  readonly projection: Projection;
  readonly measurements: SupplementalMeasurements;
  readonly previous: Scene | null;
  readonly options: LayoutOptions;
  readonly job: Job;
}
export interface RouteRequest {
  readonly projection: Projection;
  readonly measurements: SupplementalMeasurements;
  readonly options: LayoutOptions;
  readonly fixed: Scene;
  readonly job: Job;
}
export interface InspectionRequest {
  readonly projection: Projection;
  readonly measurements: SupplementalMeasurements;
  readonly options: LayoutOptions;
  readonly candidate: Scene;
}
export interface Inspection {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
}
/** The module-roads engine: places one section from measured content, optionally around fixed nodes. */
export interface NestedLayout {
  readonly version: string;
  section(
    source: VisualSection,
    metrics: SupplementalMeasurements,
    options: LayoutOptions,
    versions: readonly string[],
    fixedNodes?: readonly PlacedNode[],
  ): PlacedSection;
  readonly measure?: PrototypeLayoutMeasure;
}
export interface Dependencies {
  readonly nested?: NestedLayout;
  readonly engineVersions?: readonly string[];
  readonly projection: ProjectionReader;
  readonly placement: PlacementPort;
  readonly solver: SolverPort;
  readonly routing: RoutingPort;
  readonly jobs: JobControl;
}
/** Geometry derivation consumes engine/scheduling roles only; the facade alone decodes Projection input. */
export type GeometryDependencies = Omit<Dependencies, 'projection'>;
/** Common immutable job/options data is separate from the operation-specific provider set. */
export interface WorkContext<Providers> {
  readonly dependencies: Providers;
  readonly options: LayoutOptions;
  readonly job: Job;
}
export type SeedContext = WorkContext<Pick<GeometryDependencies, 'placement' | 'jobs'>>;
export type PlacementContext = WorkContext<
  Pick<GeometryDependencies, 'placement' | 'solver' | 'jobs'>
>;
export type RoutingContext = WorkContext<Pick<GeometryDependencies, 'routing' | 'jobs'>>;
export type DerivationContext = WorkContext<GeometryDependencies>;
/** Public geometry derivation cannot mutate meaning; Authoring retains prior state on any failed result. */
export interface Layout {
  key(input: unknown): Result<LayoutInputKey>;
  arrange(input: unknown): Promise<Result<Scene>>;
  route(input: unknown): Promise<Result<Scene>>;
  inspect(input: unknown): Result<Inspection>;
}

/** Browser admission uses producing engine versions without loading those native engines. */
export interface SceneReaderOwners {
  readonly projection: ProjectionReader;
  readonly engineVersions: readonly string[];
}
