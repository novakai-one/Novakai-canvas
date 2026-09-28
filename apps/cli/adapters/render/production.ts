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

/** A render lays out from scratch: there is no earlier layout to keep the boxes steady against. */
const noPreviousScene = null;

/** The ID every headless render job gets. */
const headlessJobId = 'headless';

/**
 * Gives the render its `layOut` and `inspect` steps, using the service's `tools`. `layOut` fails
 * if the empty library or the job can't be made, or as the service's layout does.
 */
export function createServiceLayout(
  tools: ServiceLayoutTools,
): Pick<RenderOutput, 'layOut' | 'inspect'> {
  return {
    layOut: (collection, catalog) => layOutCollection(tools, collection, catalog),
    inspect: tools.inspectDocument,
  };
}

/** Makes the render job for the collection, then has the service lay it out as a document. */
async function layOutCollection(
  tools: ServiceLayoutTools,
  collection: Collection,
  catalog: Catalog,
): Promise<Result<RenderDocument, RenderFailureSource>> {
  const job = makeRenderJob(tools.renderJobs, collection, catalog);
  if (!job.ok) {
    return job;
  }
  // Nothing cancels a headless render, so the signal is never aborted.
  const neverCancelled = new AbortController().signal;
  return tools.produceDiagram(job.value, neverCancelled);
}

/** Makes the job over the one collection, the render's catalog and an empty library. */
function makeRenderJob(
  renderJobs: ServiceLayoutTools['renderJobs'],
  collection: Collection,
  catalog: Catalog,
): Result<RenderingJob, RenderFailureSource> {
  const library = makeEmptyLibrary();
  if (!library.ok) {
    return library;
  }
  const view = { collections: [collection], presets: catalog, library: library.value };
  return renderJobs.create(collection, view, noPreviousScene, headlessJobId);
}

/** Makes the empty library a headless render runs against, checked by Library. */
function makeEmptyLibrary(): LibraryResult<LibrarySnapshot> {
  return validateLibrarySnapshot({
    organisation: { schemaVersion: 1, id: 'headless', revision: 0, folders: [], entries: [] },
    collections: [],
    recent: [],
  });
}
