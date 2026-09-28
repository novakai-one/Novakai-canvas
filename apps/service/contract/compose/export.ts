/*
 * Why this file exists
 *
 * The exporter behind `POST /api/v1/export` needs a few things ready before its first request:
 * Presentation set up with the shipped fonts, the shared parts (compose/shared-parts.ts), and a
 * PNG encoder.
 *
 * This file builds the exporter for one workspace. The PNG encoder starts only on the first PNG
 * request. An export only reads the workspace; it never changes it.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import type { Assets } from '@novakai/canvas-assets';
import type { Authoring } from '@novakai/canvas-authoring';
import type { WorkspaceOptions } from '../records/workspace/startup.js';
import type { PreparedBuiltins } from '../records/presets/builtins.js';
import type { Exporter } from '../ports/export.js';
import type { ServiceCapabilities } from '../ports/capabilities.js';
import type { Result } from '../errors.js';
import { failure, success } from '../errors.js';
import { createExporter } from '../../core/export/route.js';
import { createPngEncoder } from '../../adapters/raster/png-runtime.js';
import type { SharedParts } from './shared-parts.js';

/** What the exporter is built from, besides Authoring. */
export interface ExportInputs {
  readonly stores: { readonly assets: Pick<Assets, 'acquire'> };
  readonly builtins: Pick<PreparedBuiltins, 'fonts'>;
  readonly options: Pick<WorkspaceOptions, 'workspace'>;
  readonly capabilities: Pick<ServiceCapabilities, 'model' | 'language' | 'export'>;
  readonly shared: Pick<SharedParts, 'reader' | 'resources' | 'renderer'>;
}

/**
 * Builds the exporter of one workspace. `authoring` makes Authoring for one request; the exporter
 * uses it only to read the workspace. Fails with `unavailable` at `startup` when Presentation
 * can't load the shipped fonts.
 */
export async function buildExporter(
  inputs: ExportInputs,
  authoring: (signal: AbortSignal) => Authoring,
): Promise<Result<Exporter>> {
  const presentation = await createReactBindings(inputs.builtins.fonts);
  if (!presentation.ok) {
    return failure('unavailable', 'startup', 'Workspace composition failed');
  }
  const { model, language } = inputs.capabilities;
  const { reader, resources, renderer } = inputs.shared;
  return success(
    createExporter({
      workspace: inputs.options.workspace,
      model,
      language,
      export: inputs.capabilities.export,
      presentation: presentation.value,
      assets: inputs.stores.assets,
      views: reader,
      resources,
      renderer,
      pngEncoder: createPngEncoder(),
      authoring,
    }),
  );
}
