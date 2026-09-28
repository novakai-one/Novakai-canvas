/*
 * Why this file exists
 *
 * Drawing a collection takes two parts. The service lays the collection out as a document: where
 * each box and wire goes. Then Export turns each section of that document into SVG or PNG bytes,
 * so a collection with two sections becomes two images.
 *
 * This file names what a render asks of those two parts. It writes no file;
 * `core/render/sections.ts` does. Each part's failure comes back whole.
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

/** What Export needs to draw a render's sections. */
export interface ExportInput {
  readonly document: RenderDocument;
  readonly snapshot: ExportSnapshot;
  /** The fonts, images and themes the source's names stand for. */
  readonly pins: ResolvedResources;
  /** Lets Export use only the fonts and images the snapshot kept. */
  readonly resources: Resources;
}

/** Export, set up for one render's drawing, format and label choice. */
export interface SectionExporter {
  /** Makes one section's image bytes. Fails with Export's or Presentation's finding. */
  export(section: SectionId): Promise<Result<Uint8Array, RenderEvidence>>;
}

/** What a render asks of the service and of Export. */
export interface RenderOutput {
  /**
   * Lays out `collection` as a document, using the themes and recipes in `catalog`. Fails with the
   * service's own failure.
   */
  produce(
    collection: Collection,
    catalog: Catalog,
  ): Promise<Result<RenderDocument, RenderEvidence>>;
  /** The service's report on a document it laid out, such as how many wires cross. Never fails. */
  inspect(document: RenderDocument): InspectionReport;
  /** Sets up Export to draw one render's sections. Fails if Presentation can't load a font. */
  exporter(input: ExportInput): Promise<Result<SectionExporter, RenderEvidence>>;
}
