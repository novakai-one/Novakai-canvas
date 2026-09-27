/*
 * The workspace export route, bound to Presentation's bindings for the installation fonts. The PNG
 * runtime starts lazily, on the first PNG request. Every export only reads, through a leased
 * snapshot; the caller owns the retry.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import type { Authoring } from '@novakai/canvas-authoring';
import type { NativeWorkspace, WorkspaceOptions } from '../records/workspace/startup.js';
import type { BuiltinResources } from '../records/presets/builtins.js';
import type { ExportHandler } from '../records/export/export.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { createExportRoute } from '../../core/export/route.js';
import { createPngRuntime } from '../../adapters/raster/png-runtime.js';
import type { WorkspaceRoles } from './workspace.js';

/** What the export route reads through, besides Authoring. */
export interface ExportInputs {
  readonly native: Pick<NativeWorkspace, 'assets'>;
  readonly installation: BuiltinResources;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly capabilities: ServiceCapabilities;
  readonly roles: WorkspaceRoles;
}

/**
 * Binds the export route of one workspace; `authoring` is bound to one request's cancellation.
 * Fails with `unavailable` at `startup` ("Workspace composition failed") when Presentation cannot
 * bind the installation fonts.
 */
export async function wireExport(
  inputs: ExportInputs,
  authoring: (signal: AbortSignal) => Authoring,
): Promise<Result<ExportHandler>> {
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
      png: createPngRuntime(),
      authoring,
    }),
  );
}
