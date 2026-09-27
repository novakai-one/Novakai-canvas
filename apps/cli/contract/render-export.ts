/*
 * The Export stage of one headless render: compose Export over the rendered document, start the
 * raster engine for PNG, create the output directory and write every section to its file. Not
 * pure: writes through the injected RenderFiles port. A failure throws RenderFault through
 * accepted(); renderHeadless (adapters/edge/headless.ts) converts it and owns recovery.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import { composeExport, type Snapshot } from '@novakai/canvas-export';
import { sectionId, type SectionId } from '@novakai/canvas-model';
import { accepted, resourceInspector } from './api.js';
import { exportDocuments, type Environment } from './render.js';
import type { FilePath, HeadlessOptions, HeadlessReport } from './records/headless.js';
import type { RenderFiles } from './ports/render.js';
import type { Catalog, RenderDocument } from './records/foreign.js';

/** The render file steps the Export stage uses. */
type ExportFiles = Pick<RenderFiles, 'prepareRaster' | 'prepareOutput' | 'writeSection'>;

/**
 * Export acquires one immutable scene and emits every section with filesystem-safe ids.
 *
 * Throws RenderFault with the presentation, Export or `provider-failed` evidence of the first
 * failing step. Layout keeps each section id as plain text; it is checked back into Model's
 * SectionId here. The ids come from the Model-validated collection, so that check cannot fail.
 */
export async function exportSections(
  options: HeadlessOptions,
  files: ExportFiles,
  snapshot: Snapshot,
  document: RenderDocument,
  env: Environment,
  catalog: Catalog,
): Promise<HeadlessReport['files']> {
  const presentation = accepted(await createReactBindings(document.fonts));
  const exporter = composeExport({
    presentation,
    readerCss: '',
    allLabels: options.labels === true,
    snapshots: {
      acquire: async () => ({
        ok: true,
        value: { snapshot, release: async () => ({ ok: true, value: undefined }) },
      }),
    },
    documents: exportDocuments(env.language, catalog, snapshot.collection.assets),
    resources: resourceInspector(snapshot.resources),
  });
  await raster(options, files);
  accepted(await files.prepareOutput());
  return Promise.all(
    document.scene.sections.map(async (section) =>
      exportSection(options, files, exporter, snapshot, sectionId.parse(section.id)),
    ),
  );
}

/** Write one section's artifact to its deterministic file and return the path. */
async function exportSection(
  options: HeadlessOptions,
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
      format: options.format,
      scope: { kind: 'section', id: section },
    }),
  );
  return accepted(await files.writeSection(section, artifact.bytes));
}

/** Real raster engine initialization is needed only by PNG requests. */
async function raster(
  options: HeadlessOptions,
  files: ExportFiles,
): Promise<void> {
  if (options.format !== 'png') return;
  accepted(await files.prepareRaster());
}
