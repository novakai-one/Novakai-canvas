/*
 * The Export stage of one headless render: compose Export over the rendered document, start the
 * raster engine for PNG, create the output directory and write every section to its file. Not
 * pure: writes through the injected RenderFiles port. A failure throws RenderAbort through
 * accepted(); renderHeadless (adapters/edge/headless.ts) converts it and owns recovery.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import { composeExport, type Snapshot } from '@novakai/canvas-export';
import { accepted, resourceInspector } from './api.js';
import { exportDocuments, type Environment } from './render.js';
import { sectionId, type FilePath, type SectionId } from './brands.js';
import type { RenderReport, RenderRequest } from './records/render.js';
import type { RenderFiles } from './ports/render.js';
import type { Catalog, RenderDocument } from './records/foreign.js';

/** The render file steps the Export stage uses. */
type ExportFiles = Pick<RenderFiles, 'prepareRaster' | 'prepareOutput' | 'writeSection'>;

/**
 * Export acquires one immutable scene and emits every section with filesystem-safe ids.
 *
 * Throws RenderAbort with the presentation, Export or `provider-failed` evidence of the first
 * failing step. Layout keeps each section id as plain text; it is checked back into Model's
 * SectionId here. The ids come from the Model-validated collection, so that check cannot fail.
 */
export async function exportSections(
  request: RenderRequest,
  files: ExportFiles,
  snapshot: Snapshot,
  document: RenderDocument,
  env: Environment,
  catalog: Catalog,
): Promise<RenderReport['files']> {
  const presentation = accepted(await createReactBindings(document.fonts));
  const exporter = composeExport({
    presentation,
    readerCss: '',
    allLabels: request.labels === 'all',
    snapshots: {
      acquire: async () => ({
        ok: true,
        value: { snapshot, release: async () => ({ ok: true, value: undefined }) },
      }),
    },
    documents: exportDocuments(env.language, catalog, snapshot.collection.assets),
    resources: resourceInspector(snapshot.resources),
  });
  await raster(request, files);
  accepted(await files.prepareOutput());
  return Promise.all(
    document.scene.sections.map(async (section) =>
      exportSection(request, files, exporter, snapshot, sectionId.parse(section.id)),
    ),
  );
}

/** Write one section's artifact to its deterministic file and return the path. */
async function exportSection(
  request: RenderRequest,
  files: ExportFiles,
  exporter: ReturnType<typeof composeExport>,
  snapshot: Snapshot,
  section: SectionId,
): Promise<FilePath> {
  const artifact = accepted(
    await exporter.service.exportArtifact({
      identity: {
        collectionId: snapshot.collection.id,
        revision: snapshot.collection.revision,
      },
      format: request.format,
      scope: { kind: 'section', id: section },
    }),
  );
  return accepted(await files.writeSection(section, artifact.bytes));
}

/** Real raster engine initialization is needed only by PNG requests. */
async function raster(
  request: RenderRequest,
  files: ExportFiles,
): Promise<void> {
  if (request.format !== 'png') return;
  accepted(await files.prepareRaster());
}
