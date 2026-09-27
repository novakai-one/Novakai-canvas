/*
 * The headless render boundary: one read-only render runs in a temporary directory — admission,
 * lowering, projection, layout, export — and stored collections are never touched. The render
 * rules (themes, source, assets, collection, snapshot) live in core/render behind
 * contract/api.js and return Results; capability wiring lives in contract/render.js and the Export
 * stage in contract/render-export.js; file I/O, the temporary asset store and raster start-up are
 * injected (adapters/render/). This adapter owns the owner sequence and the RenderAbort boundary:
 * accepted() unwraps each step and throws its evidence, renderHeadless converts it to a typed
 * failure, and the temporary directory is always removed.
 */
import type { RenderReport, RenderRequest } from '../../contract/records/render.js';
import type { ProviderFault, RenderFailure } from '../../contract/records/render-failure.js';
import type { HeadlessOwners, TempDirectory } from '../../contract/ports/render.js';
import type { Result } from '../../contract/errors.js';
import {
  accepted,
  admitThemes,
  evidence,
  renderCollection,
  renderReport,
  renderSnapshot,
} from '../../contract/api.js';
import { exportSections } from '../../contract/render-export.js';
import {
  environment,
  renderEnvironment,
  renderJob,
  type Environment,
} from '../../contract/render.js';

/**
 * Render every section of one collection to files, read-only.
 *
 * Owner failures keep their structured evidence; unexpected filesystem failures become
 * `provider-failed`. Either way the render is `render-failed`, stored collections are
 * untouched, and the temporary admission directory is removed. A failure to create or remove
 * that directory is not a `render-failed` value: it escapes as an Error with the OS message.
 */
export async function renderHeadless(
  request: RenderRequest,
  owners: HeadlessOwners,
): Promise<Result<RenderReport, RenderFailure>> {
  const temp = escaped(await owners.temp.create());
  try {
    return { ok: true, value: await render(request, owners, temp) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'render-failed',
        message: 'Headless render rejected',
        recovery:
          'Correct the named input or resource and rerun; stored collections were not changed.',
        source: evidence(error),
      },
    };
  } finally {
    escaped(await temp.remove());
  }
}

/**
 * Unwrap a temporary-directory step. A failure throws a plain Error with the OS message, the
 * same line the host printed when mkdtemp and rm threw here directly.
 */
function escaped<T>(result: Result<T, ProviderFault>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Owner sequence: admission, lowering, projection, layout, export; assets always close. */
async function render(
  request: RenderRequest,
  owners: HeadlessOwners,
  temp: TempDirectory,
): Promise<RenderReport> {
  const assets = accepted(temp.openAssets());
  try {
    return await renderWith(request, owners, await environment(request, owners, assets));
  } finally {
    accepted(assets.close());
  }
}

/**
 * One prepared environment drives the whole render: themes, then the collection, then the
 * produced document, its snapshot, the section files and the report.
 */
async function renderWith(
  request: RenderRequest,
  owners: HeadlessOwners,
  env: Environment,
): Promise<RenderReport> {
  const rules = {
    env: renderEnvironment(env, owners.service),
    files: owners.files,
    resources: owners.resources,
  };
  const themes = accepted(await admitThemes(request, rules));
  const collection = accepted(await renderCollection(request.collection, themes, rules));
  const job = renderJob(request, owners, env, themes.catalog, collection);
  const document = accepted(await owners.service.produceDiagram(job, new AbortController().signal));
  const snapshot = accepted(renderSnapshot(collection, document, themes.catalog, rules.env));
  const files = await exportSections(
    request,
    owners.files,
    snapshot,
    document,
    env,
    themes.catalog,
  );
  return renderReport(files, collection, document, themes.catalog);
}
