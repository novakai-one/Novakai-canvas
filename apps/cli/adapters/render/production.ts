/*
 * Why this file exists
 *
 * Before a section can be drawn, its collection must be laid out: where each box and wire goes.
 * The service does that for the web app, and a render reuses the same code with no server. It
 * needs a render job: the collection, the themes and recipes the render knows, and an empty
 * library, since a render has no saved workspace.
 *
 * This file makes that job and has the service lay it out. It reads and writes no files itself;
 * the service's tools load the layout engine's WebAssembly file. Mistakes come back as values.
 */
import {
  validateLibrarySnapshot,
  type LibraryResult,
  type LibrarySnapshot,
} from '@novakai/canvas-library';
import type { RenderingJob } from '@novakai/canvas-service';
import type { RenderOutput } from '../../contract/ports/render-output.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type {
  Catalog,
  Collection,
  HeadlessTools,
  RenderDocument,
} from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';

/** The service's layout code, already loaded with the render's assets, themes and layout engine. */
export interface ServiceLayoutTools {
  /** The service's render jobs; `renderJobs.create` makes the job for one collection. */
  readonly renderJobs: ReturnType<HeadlessTools['createRenderJobs']>;
  /** Lays a render job out as a document. */
  readonly produceDiagram: HeadlessTools['produceDiagram'];
  /** The service's report on a laid-out document, such as how many wires cross. */
  readonly inspectDocument: RenderOutput['inspect'];
}

/**
 * Gives the render its `layOut` and `inspect` steps, using the service's `tools`. `layOut` fails
 * if the empty library or the job can't be made, or as the service's layout does.
 */
export function createServiceLayout(
  tools: ServiceLayoutTools,
): Pick<RenderOutput, 'layOut' | 'inspect'> {
  return {
    layOut: (collection, catalog) => producedDiagram(tools, collection, catalog),
    inspect: tools.inspectDocument,
  };
}

/**
 * The service's document of `collection`, drawn over `catalog`. Fails with Library's check of
 * the headless library, the render job's failure or the producer's. Nothing cancels a headless
 * render.
 */
async function producedDiagram(
  tools: ServiceLayoutTools,
  collection: Collection,
  catalog: Catalog,
): Promise<Result<RenderDocument, RenderFailureSource>> {
  const job = renderJob(tools.renderJobs, collection, catalog);
  if (!job.ok) return job;
  return tools.produceDiagram(job.value, new AbortController().signal);
}

/** The job over one collection, the catalog and the headless library. Fails as either does. */
function renderJob(
  renderJobs: ServiceLayoutTools['renderJobs'],
  collection: Collection,
  catalog: Catalog,
): Result<RenderingJob, RenderFailureSource> {
  const library = headlessLibrary();
  if (!library.ok) return library;
  const view = { collections: [collection], presets: catalog, library: library.value };
  return renderJobs.create(collection, view, null, 'headless');
}

/** The empty library snapshot headless renders run against. Fails with Library's diagnostics. */
function headlessLibrary(): LibraryResult<LibrarySnapshot> {
  return validateLibrarySnapshot({
    organisation: { schemaVersion: 1, id: 'headless', revision: 0, folders: [], entries: [] },
    collections: [],
    recent: [],
  });
}
