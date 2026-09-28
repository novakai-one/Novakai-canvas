/*
 * Why this file exists
 *
 * The export route (`POST /api/v1/export`) needs a few things ready before its first request:
 * Presentation set up with the shipped fonts, the workspace roles, and a PNG encoder.
 *
 * This file builds the route for one workspace. The PNG encoder starts only on the first PNG
 * request. An export only reads the workspace; it never changes it.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import type { Assets } from '@novakai/canvas-assets';
import type { Authoring } from '@novakai/canvas-authoring';
import type { WorkspaceOptions } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ExportRoute } from '../ports/export.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { createExportRoute } from '../../core/export/route.js';
import { createRasterizer } from '../../adapters/raster/png-runtime.js';
import type { WorkspaceRoles } from './workspace.js';

/** What the export route is built from, besides Authoring. */
export interface ExportInputs {
  readonly native: { readonly assets: Pick<Assets, 'acquire'> };
  readonly installation: Pick<BuiltinResources, 'fonts'>;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly capabilities: Pick<ServiceCapabilities, 'model' | 'language' | 'export'>;
  readonly roles: Pick<WorkspaceRoles, 'views' | 'resources' | 'renderer'>;
}

/**
 * Builds the export route of one workspace. `authoring` makes Authoring for one request. Fails
 * with `unavailable` at `startup` when Presentation can't load the shipped fonts.
 */
export async function wireExport(
  inputs: ExportInputs,
  authoring: (signal: AbortSignal) => Authoring,
): Promise<Result<ExportRoute>> {
  const presentation = await createReactBindings(inputs.installation.fonts);
  if (!presentation.ok) {
    return failure('unavailable', 'startup', 'Workspace composition failed');
  }
  const { model, language } = inputs.capabilities;
  const { views, resources, renderer } = inputs.roles;
  return success(
    createExportRoute({
      workspace: inputs.options.workspace,
      model,
      language,
      export: inputs.capabilities.export,
      presentation: presentation.value,
      assets: inputs.native.assets,
      views,
      resources,
      renderer,
      rasterizer: createRasterizer(),
      authoring,
    }),
  );
}
