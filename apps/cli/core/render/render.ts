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
import type { RenderOutput } from '../../contract/ports/render-output.js';
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
import { retainedResourceCheck } from './retained-resources.js';
import { exportSections } from './sections.js';
import { buildExportSnapshot } from './snapshot.js';
import { admitThemes } from './themes.js';

/** What every render failure tells the caller to do: nothing stored changed. */
const recovery =
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

/** A drawing with the service's document of it and the snapshot Export reads. */
interface Produced extends Drawing {
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
  const opened = await guarded(ports.open());
  if (!opened.ok) return rejected(opened.error);
  const environment = opened.value;
  const rendered = await guarded(renderIn(request, joinPorts(environment, ports)));
  return closedAfter(rendered, await guarded(environment.close()));
}

/** The open environment's ports joined with the file ports, resource reads and theme reader. */
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

/** `work`'s own outcome; a rejection becomes `provider-failed` with its native evidence. */
function guarded<T>(
  work: Promise<Result<T, RenderFailureSource>>,
): Promise<Result<T, RenderFailureSource>> {
  return work.catch((error: unknown) => providerFailure(error));
}

/** After the close: the render's own failure first, then the close's; otherwise the report. */
function closedAfter(
  rendered: Result<RenderReport, RenderFailureSource>,
  closed: Result<void, RenderFailureSource>,
): Result<RenderReport, RenderFailure> {
  if (!rendered.ok) return rejected(rendered.error);
  if (!closed.ok) return rejected(closed.error);
  return rendered;
}

/** `source` as the `render-failed` record render:png prints. */
function rejected(source: RenderFailureSource): Result<never, RenderFailure> {
  return {
    ok: false,
    error: { code: 'render-failed', message: 'Headless render rejected', recovery, source },
  };
}

/**
 * The themes admitted, then the chosen collection drawn with them, then produced and exported.
 * Fails as the first failing step does.
 */
async function renderIn(
  request: RenderRequest,
  ports: JoinedPorts,
): Promise<Result<RenderReport, RenderFailureSource>> {
  const themes = await admitThemes(request, ports);
  if (!themes.ok) return themes;
  const collection = await loadCollection(request.collection, themes.value, ports);
  if (!collection.ok) return collection;
  return drawn(request, ports, { collection: collection.value, catalog: themes.value.catalog });
}

/**
 * The service's document of the drawing and its export snapshot, then the export. Fails with the
 * service's failure, the snapshot's asset failure, or as {@link exported} does.
 */
async function drawn(
  request: RenderRequest,
  ports: JoinedPorts,
  drawing: Drawing,
): Promise<Result<RenderReport, RenderFailureSource>> {
  const document = await ports.output.layOut(drawing.collection, drawing.catalog);
  if (!document.ok) return document;
  const snapshot = buildExportSnapshot(
    drawing.collection,
    document.value,
    drawing.catalog,
    ports.assets,
  );
  if (!snapshot.ok) return snapshot;
  return exported(request, ports, {
    ...drawing,
    document: document.value,
    snapshot: snapshot.value,
  });
}

/**
 * Export opened over the snapshot, every section written to its file, then the report with the
 * service's inspection of the document. Fails with Presentation's font failure, or as the section
 * export does.
 */
async function exported(
  request: RenderRequest,
  ports: JoinedPorts,
  produced: Produced,
): Promise<Result<RenderReport, RenderFailureSource>> {
  const exporter = await ports.output.prepareExporter({
    document: produced.document,
    snapshot: produced.snapshot,
    resolvedResources: pinResources(produced.catalog, produced.snapshot.collection.assets),
    resources: retainedResourceCheck(produced.snapshot.resources),
  });
  if (!exporter.ok) return exporter;
  const files = await exportSections(request.format, ports, exporter.value, produced.document);
  if (!files.ok) return files;
  const inspection = ports.output.inspect(produced.document);
  return success(buildRenderReport(files.value, produced.collection, inspection, produced.catalog));
}
