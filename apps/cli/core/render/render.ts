/*
 * Why this file exists
 *
 * `pnpm render:png --collection states --out out/` draws a collection into image files, one per
 * section, without a browser. That takes several parts in turn: the themes, the collection, the
 * service's layout, then Export. Any of them can fail, and the render's temporary store must be
 * removed whatever happens.
 *
 * This file runs those parts in order and always closes the store last. Each step gives back a
 * `Result` (see `contract/errors.ts`); the first mistake becomes one `render-failed` record. It
 * never changes a saved collection.
 */
import type { RenderEnvironment, RenderPorts } from '../../contract/ports/render.js';
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { InputFiles, RasterEngine, SectionFiles } from '../../contract/ports/render-files.js';
import type { ExportInput, RenderOutput } from '../../contract/ports/render-output.js';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type { RenderThemes } from '../../contract/ports/render-themes.js';
import type { ThemeReader } from '../../contract/ports/theme-reader.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type {
  Catalog,
  Collection,
  ExportSnapshot,
  RenderDocument,
} from '../../contract/records/foreign.js';
import type { RenderReport, RenderRequest } from '../../contract/records/render.js';
import type { RenderFailureSource, RenderFailure } from '../../contract/records/render-failure.js';
import { providerFailure, success, type Result } from '../../contract/errors.js';
import { loadCollection } from './collection.js';
import { pinResources } from './pins.js';
import { buildRenderReport } from './report.js';
import { buildResourceCheck } from './retained-resources.js';
import { exportSections } from './sections.js';
import { buildExportSnapshot } from './snapshot.js';
import { admitThemes } from './themes.js';

/** What every render failure tells the caller to do: nothing stored changed. */
const renderFailedRecovery =
  'Correct the named input or resource and rerun; stored collections were not changed.';

/**
 * What one open render runs with: the environment's ports, the file ports, resource reads and the
 * theme reader.
 */
interface JoinedPorts {
  readonly sources: RenderSources;
  readonly assets: RenderAssets;
  readonly themes: RenderThemes;
  readonly output: RenderOutput;
  readonly inputFiles: InputFiles;
  readonly raster: RasterEngine;
  readonly sectionFiles: SectionFiles;
  readonly resources: ResourceReader;
  readonly themeReader: ThemeReader;
}

/** A checked collection and the catalog it was drawn against. */
interface Drawing {
  readonly collection: Collection;
  readonly catalog: Catalog;
}

/** A drawing with the service's laid-out document of it and the snapshot Export reads. */
interface LaidOutDrawing extends Drawing {
  readonly document: RenderDocument;
  readonly snapshot: ExportSnapshot;
}

/**
 * Draws the collection `request` names into one image file per section, and reports what it wrote.
 * The render's temporary store is opened first and closed last, even after a mistake. Any mistake
 * comes back as `render-failed`, with the first failure kept whole as its `source`.
 */
export async function renderCollection(
  request: RenderRequest,
  ports: RenderPorts,
): Promise<Result<RenderReport, RenderFailure>> {
  const opened = await catchThrown(ports.open());
  if (!opened.ok) {
    return renderFailedFailure(opened.error);
  }
  const environment = opened.value;
  const joinedPorts = joinPorts(environment, ports);
  const rendered = await catchThrown(renderInEnvironment(request, joinedPorts));
  const closed = await catchThrown(environment.close());
  return reportOrFirstFailure(rendered, closed);
}

/** Joins the open environment's ports with the file ports, resource reads and theme reader. */
function joinPorts(
  environment: RenderEnvironment,
  ports: RenderPorts,
): JoinedPorts {
  return {
    sources: environment.sources,
    assets: environment.assets,
    themes: environment.themes,
    output: environment.output,
    inputFiles: ports.inputFiles,
    raster: ports.raster,
    sectionFiles: ports.sectionFiles,
    resources: ports.resources,
    themeReader: ports.themeReader,
  };
}

/** Waits for `work`, and turns a throw into `provider-failed`, keeping what was thrown. */
function catchThrown<T>(
  work: Promise<Result<T, RenderFailureSource>>,
): Promise<Result<T, RenderFailureSource>> {
  return work.catch(providerFailure);
}

/** Admits the themes, loads the collection, then lays it out and exports it. */
async function renderInEnvironment(
  request: RenderRequest,
  ports: JoinedPorts,
): Promise<Result<RenderReport, RenderFailureSource>> {
  const themes = await admitThemes(request, ports);
  if (!themes.ok) {
    return themes;
  }
  const collection = await loadCollection(request.collection, themes.value, ports);
  if (!collection.ok) {
    return collection;
  }
  const drawing: Drawing = { collection: collection.value, catalog: themes.value.catalog };
  return layOutDrawing(request, ports, drawing);
}

/**
 * Has the service lay out the drawing, builds the snapshot Export draws from, then exports every
 * section.
 */
async function layOutDrawing(
  request: RenderRequest,
  ports: JoinedPorts,
  drawing: Drawing,
): Promise<Result<RenderReport, RenderFailureSource>> {
  const document = await ports.output.layOut(drawing.collection, drawing.catalog);
  if (!document.ok) {
    return document;
  }
  const snapshot = buildExportSnapshot(
    drawing.collection,
    document.value,
    drawing.catalog,
    ports.assets,
  );
  if (!snapshot.ok) {
    return snapshot;
  }
  const laidOut: LaidOutDrawing = {
    ...drawing,
    document: document.value,
    snapshot: snapshot.value,
  };
  return exportDrawing(request, ports, laidOut);
}

/**
 * Sets up Export, writes every section to its file, then puts together the report with the
 * service's inspection of the drawing.
 */
async function exportDrawing(
  request: RenderRequest,
  ports: JoinedPorts,
  laidOut: LaidOutDrawing,
): Promise<Result<RenderReport, RenderFailureSource>> {
  const exportInput = buildExportInput(laidOut);
  const exporter = await ports.output.prepareExporter(exportInput);
  if (!exporter.ok) {
    return exporter;
  }
  const files = await exportSections(request.format, ports, exporter.value, laidOut.document);
  if (!files.ok) {
    return files;
  }
  const inspection = ports.output.inspect(laidOut.document);
  const report = buildRenderReport(files.value, laidOut.collection, inspection, laidOut.catalog);
  return success(report);
}

/**
 * Puts together what Export needs: the document, the snapshot, what the snapshot's names stand
 * for, and the check Export runs on its bytes.
 */
function buildExportInput(laidOut: LaidOutDrawing): ExportInput {
  const resolvedResources = pinResources(laidOut.catalog, laidOut.snapshot.collection.assets);
  const resources = buildResourceCheck(laidOut.snapshot.resources);
  return {
    document: laidOut.document,
    snapshot: laidOut.snapshot,
    resolvedResources,
    resources,
  };
}

/**
 * Gives back the report, or the first mistake as `render-failed`. The render's own mistake comes
 * before the close's.
 */
function reportOrFirstFailure(
  rendered: Result<RenderReport, RenderFailureSource>,
  closed: Result<void, RenderFailureSource>,
): Result<RenderReport, RenderFailure> {
  if (!rendered.ok) {
    return renderFailedFailure(rendered.error);
  }
  if (!closed.ok) {
    return renderFailedFailure(closed.error);
  }
  return rendered;
}

/** Makes the `render-failed` mistake render:png prints, with the first failure kept whole. */
function renderFailedFailure(source: RenderFailureSource): Result<never, RenderFailure> {
  const renderFailed: RenderFailure = {
    code: 'render-failed',
    message: 'Headless render rejected',
    recovery: renderFailedRecovery,
    source,
  };
  return { ok: false, error: renderFailed };
}
