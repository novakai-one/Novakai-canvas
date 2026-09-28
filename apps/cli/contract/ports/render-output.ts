/*
 * The render environment's output: the service draws one collection into a document and inspects
 * it, and Export turns each section of its snapshot into file bytes. Declarations only;
 * adapters/render/production.ts and exporter.ts implement it. Writes nothing;
 * core/render/sections.ts writes the bytes through the section files port. Every failure is the
 * owner's evidence, returned as a value.
 */
import type { RenderEvidence } from '../records/render-failure.js';
import type {
  Catalog,
  Collection,
  ExportSnapshot,
  InspectionReport,
  RenderDocument,
  ResolvedResources,
  Resources,
} from '../records/foreign.js';
import type { SectionId } from '../brands.js';
import type { Result } from '../errors.js';

/** What Export draws one render's sections from. */
export interface ExportInput {
  readonly document: RenderDocument;
  readonly snapshot: ExportSnapshot;
  /** The pins Export's documents port lowers DSL against. */
  readonly pins: ResolvedResources;
  /** The inspector that admits only resources the snapshot retained. */
  readonly resources: Resources;
}

/** Export bound to one snapshot, format and label mode. */
export interface SectionExporter {
  /** One section's file bytes. Fails with Export's or Presentation's diagnostic. */
  export(section: SectionId): Promise<Result<Uint8Array, RenderEvidence>>;
}

/** The service's drawing and its inspection, and Export, for one render. */
export interface RenderOutput {
  /**
   * The service's rendered document of `collection` over `catalog`. Fails with Library's, the
   * render job's or the producer's failure.
   */
  produce(
    collection: Collection,
    catalog: Catalog,
  ): Promise<Result<RenderDocument, RenderEvidence>>;
  /** The service's inspection report of a document it produced. Cannot fail. */
  inspect(document: RenderDocument): InspectionReport;
  /** Export over one snapshot. Fails with Presentation's font failure. */
  exporter(input: ExportInput): Promise<Result<SectionExporter, RenderEvidence>>;
}
