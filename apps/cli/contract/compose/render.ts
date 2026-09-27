/*
 * `pnpm render:png` wiring: the service's headless render bindings, the resource reader, the theme
 * grammar, the render's temporary asset store and its file I/O, bound for one read-only render.
 * Not pure: imports the render adapters lazily and reads and writes files. Failures are returned
 * as values; a render changes nothing, so the caller fixes the input and runs it again.
 */
import { createResourceReader } from '../../adapters/files/resource-reader.js';
import { readThemeSource } from '../api.js';
import type { LocalFailure, Result } from '../errors.js';
import { failure } from '../errors.js';
import type { RenderChoice, RenderReport } from '../records/render.js';
import type { RenderFailure } from '../records/render-failure.js';
import { filePath } from '../brands.js';

/**
 * Headless export binds the same theme grammar and service owners without starting an HTTP
 * server, plus the render's temporary asset store and file I/O. The render adapters are imported
 * lazily, like the headless adapter. Fails with `render-failed`, or `render-unavailable` when
 * set-up throws; that includes an empty `root`, which a directory URL never gives. A
 * temporary-directory failure is not caught: it rejects with the OS error, which `cli/render.ts`
 * prints.
 */
export async function runHeadless(
  choice: RenderChoice,
  root: string,
): Promise<Result<RenderReport, RenderFailure | LocalFailure>> {
  try {
    const request = { ...choice, root: filePath.parse(root) };
    const [adapter, service, temp, files, raster] = await Promise.all([
      import('../../adapters/edge/headless.js'),
      import('@novakai/canvas-service'),
      import('../../adapters/render/temp-assets.js'),
      import('../../adapters/render/render-files.js'),
      import('../../adapters/render/raster.js'),
    ]);
    return adapter.renderHeadless(request, {
      service: await service.createHeadlessBindings(),
      resources: createResourceReader(),
      readTheme: readThemeSource,
      temp: temp.createTempAssets(),
      files: { ...files.createRenderFiles(request), ...raster.createRaster(request.root) },
    });
  } catch {
    return failure({
      code: 'render-unavailable',
      message: 'Headless rendering could not initialize',
      recovery: 'Restore local resources and retry.',
    });
  }
}
