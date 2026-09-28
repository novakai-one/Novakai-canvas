/*
 * One read-only render, start to finish: open the render's environment, admit the themes, draw the
 * chosen collection, produce its document, snapshot it, export every section to its file, report.
 * The environment is closed once, last, whatever happened. The first failure wins: a close failure
 * is reported only when the render itself succeeded. An owner that throws instead of returning its
 * failure ends the render as `provider-failed`. Pure apart from the injected ports; no stored
 * collection changes, so the caller fixes the named input and runs render:png again.
 */
import type { RenderEnvironment, RenderPorts } from '../../contract/ports/render.js';
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { InputFiles, RasterEngine, SectionFiles } from '../../contract/ports/render-files.js';
import type { RenderOutput } from '../../contract/ports/render-output.js';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type { RenderThemes } from '../../contract/ports/render-themes.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type {
  Catalog,
  Collection,
  ExportSnapshot,
  RenderDocument,
} from '../../contract/records/foreign.js';
import type { RenderReport, RenderRequest } from '../../contract/records/render.js';
import type { RenderEvidence, RenderFailure } from '../../contract/records/render-failure.js';
import { faulted, nativeFault, type Result } from '../../contract/errors.js';
import { mapped } from '../shared/results.js';
import { chosenCollection } from './collection.js';
import { pinResources } from './pins.js';
import { renderReport } from './report.js';
import { exportSections } from './sections.js';
import { renderSnapshot, resourceInspector } from './snapshot.js';
import { admitThemes } from './themes.js';

/** What every render failure tells the caller to do: nothing stored changed. */
const recovery =
  'Correct the named input or resource and rerun; stored collections were not changed.';

/** What one open render runs with: the environment's ports, the file ports and resource reads. */
interface Rules {
  readonly sources: RenderSources;
  readonly assets: RenderAssets;
  readonly themes: RenderThemes;
  readonly output: RenderOutput;
  readonly inputFiles: InputFiles;
  readonly raster: RasterEngine;
  readonly sectionFiles: SectionFiles;
  readonly resources: ResourceReader;
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
 * Render every section of `request`'s collection to files and report them. Fails with
 * `render-failed` carrying the first failure: the CLI's own fault (`collection-selection`,
 * `missing-theme`, `provider-failed`, …), a CLI failure (theme grammar, resource reads,
 * `invalid-response`), or Language, Model, Assets, Templates, service, Presentation or Export
 * evidence kept whole.
 */
export async function renderCollection(
  request: RenderRequest,
  ports: RenderPorts,
): Promise<Result<RenderReport, RenderFailure>> {
  const opened = await guarded(ports.open());
  if (!opened.ok) return rejected(opened.error);
  const env = opened.value;
  const rendered = await guarded(renderIn(request, openRules(env, ports)));
  return closedAfter(rendered, await guarded(env.close()));
}

/** The open environment's ports joined with the render's file ports and resource reads. */
function openRules(
  env: RenderEnvironment,
  ports: RenderPorts,
): Rules {
  return {
    sources: env.sources,
    assets: env.assets,
    themes: env.themes,
    output: env.output,
    inputFiles: ports.inputFiles,
    raster: ports.raster,
    sectionFiles: ports.sectionFiles,
    resources: ports.resources,
  };
}

/** `work`'s own outcome; a rejection becomes `provider-failed` with its native evidence. */
function guarded<T>(work: Promise<Result<T, RenderEvidence>>): Promise<Result<T, RenderEvidence>> {
  return work.catch((error: unknown) => faulted(nativeFault(error)));
}

/** After the close: the render's own failure first, then the close's; otherwise the report. */
function closedAfter(
  rendered: Result<RenderReport, RenderEvidence>,
  closed: Result<void, RenderEvidence>,
): Result<RenderReport, RenderFailure> {
  if (!rendered.ok) return rejected(rendered.error);
  if (!closed.ok) return rejected(closed.error);
  return rendered;
}

/** `source` as the `render-failed` record render:png prints. */
function rejected(source: RenderEvidence): Result<never, RenderFailure> {
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
  rules: Rules,
): Promise<Result<RenderReport, RenderEvidence>> {
  const themes = await admitThemes(request, rules);
  if (!themes.ok) return themes;
  const collection = await chosenCollection(request.collection, themes.value, rules);
  if (!collection.ok) return collection;
  return drawn(request, rules, { collection: collection.value, catalog: themes.value.catalog });
}

/**
 * The service's document of the drawing and its export snapshot, then the export. Fails with the
 * service's failure, the snapshot's asset failure, or as {@link exported} does.
 */
async function drawn(
  request: RenderRequest,
  rules: Rules,
  drawing: Drawing,
): Promise<Result<RenderReport, RenderEvidence>> {
  const document = await rules.output.produce(drawing.collection, drawing.catalog);
  if (!document.ok) return document;
  const snapshot = renderSnapshot(
    drawing.collection,
    document.value,
    drawing.catalog,
    rules.assets,
  );
  if (!snapshot.ok) return snapshot;
  return exported(request, rules, {
    ...drawing,
    document: document.value,
    snapshot: snapshot.value,
  });
}

/**
 * Export opened over the snapshot, every section written to its file, then the report. Fails with
 * Presentation's font failure, or as the section export does.
 */
async function exported(
  request: RenderRequest,
  rules: Rules,
  produced: Produced,
): Promise<Result<RenderReport, RenderEvidence>> {
  const exporter = await rules.output.exporter({
    document: produced.document,
    snapshot: produced.snapshot,
    pins: pinResources(produced.catalog, produced.snapshot.collection.assets),
    resources: resourceInspector(produced.snapshot.resources),
  });
  if (!exporter.ok) return exporter;
  const files = await exportSections(request.format, rules, exporter.value, produced.document);
  return mapped(files, (written) =>
    renderReport(written, produced.collection, produced.document, produced.catalog),
  );
}
