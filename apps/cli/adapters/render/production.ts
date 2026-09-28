/*
 * The output port's `produce`: the service's drawing of one collection for the headless render. A
 * render job over the collection, the admitted catalog and an empty headless library, run by the
 * service's diagram producer. Reads only the layout engine's wasm file; nothing stored is changed.
 * Failures are values; core/render/render.ts owns recovery.
 */
import {
  validateLibrarySnapshot,
  type LibraryResult,
  type LibrarySnapshot,
} from '@novakai/canvas-library';
import type { RenderingJob } from '@novakai/canvas-service';
import type { RenderOutput } from '../../contract/ports/render-output.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type {
  Catalog,
  Collection,
  HeadlessBindings,
  RenderDocument,
} from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';

/** The service's render job factory, bound to one render's capability values, and its producer. */
export interface Production {
  readonly jobs: ReturnType<HeadlessBindings['createRenderJobs']>;
  readonly produceDiagram: HeadlessBindings['produceDiagram'];
}

/**
 * The output port's drawing over `production`. Builds nothing and cannot fail; `produce` fails as
 * {@link producedDiagram}.
 */
export function createProduction(production: Production): Pick<RenderOutput, 'produce'> {
  return { produce: (collection, catalog) => producedDiagram(production, collection, catalog) };
}

/**
 * The service's document of `collection`, drawn over `catalog`. Fails with Library's check of
 * the headless library, the render job's failure or the producer's. Nothing cancels a headless
 * render.
 */
async function producedDiagram(
  production: Production,
  collection: Collection,
  catalog: Catalog,
): Promise<Result<RenderDocument, RenderEvidence>> {
  const job = renderJob(production.jobs, collection, catalog);
  if (!job.ok) return job;
  return production.produceDiagram(job.value, new AbortController().signal);
}

/** The job over one collection, the catalog and the headless library. Fails as either does. */
function renderJob(
  jobs: Production['jobs'],
  collection: Collection,
  catalog: Catalog,
): Result<RenderingJob, RenderEvidence> {
  const library = headlessLibrary();
  if (!library.ok) return library;
  const view = { collections: [collection], presets: catalog, library: library.value };
  return jobs.create(collection, view, null, 'headless');
}

/** The empty library snapshot headless renders run against. Fails with Library's diagnostics. */
function headlessLibrary(): LibraryResult<LibrarySnapshot> {
  return validateLibrarySnapshot({
    organisation: { schemaVersion: 1, id: 'headless', revision: 0, folders: [], entries: [] },
    collections: [],
    recent: [],
  });
}
