/*
 * Why this file exists
 *
 * Once the service has laid a collection out, each section still has to become image bytes:
 * `--format svg` makes one SVG per section. Export does that, and it draws each box and wire with
 * Presentation, which must load the drawing's fonts first.
 *
 * This file sets Export up for one render: its format, its `--labels` choice and its one
 * collection. It writes no file; `core/render/sections.ts` does. Mistakes come back as values.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import { composeExport, type ExportBindings, type SnapshotReader } from '@novakai/canvas-export';
import type {
  ExportInput,
  RenderOutput,
  SectionExporter,
} from '../../contract/ports/render-output.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { LabelMode, RenderFormat } from '../../contract/records/render.js';
import type {
  Documents,
  ExportSnapshot,
  ResolvedResources,
} from '../../contract/records/foreign.js';
import type { SectionId } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';

/** What Export needs from the render: the image format, which labels to draw, and `Documents`. */
export interface ExportChoices {
  readonly format: RenderFormat;
  readonly labels: LabelMode;
  /**
   * Gives Export its way to read, print and parse collections (`Documents`), using
   * `resolvedResources` for the source's font, image and theme names.
   */
  documentsFor(resolvedResources: ResolvedResources): Documents;
}

/**
 * Gives the render its `prepareExporter` step, which sets Export up with `choices` for one
 * drawing. That step fails only if Presentation can't load one of the drawing's fonts.
 */
export function createExporter(choices: ExportChoices): Pick<RenderOutput, 'prepareExporter'> {
  return { prepareExporter: (input) => openExporter(input, choices) };
}

/**
 * Export over `input`'s snapshot, drawing with the document's fonts. Fails with Presentation's
 * font failure.
 */
async function openExporter(
  input: ExportInput,
  choices: ExportChoices,
): Promise<Result<SectionExporter, RenderFailureSource>> {
  const presentation = await createReactBindings(input.document.fonts);
  if (!presentation.ok) return presentation;
  const exporter = composeExport({
    presentation: presentation.value,
    readerCss: '',
    allLabels: choices.labels === 'all',
    snapshots: lease(input.snapshot),
    documents: choices.documentsFor(input.resolvedResources),
    resources: input.resources,
  });
  return success({
    export: (section) => sectionBytes(exporter, input.snapshot, choices.format, section),
  });
}

/** A lease that hands back `snapshot`; releasing it does nothing. */
function lease(snapshot: ExportSnapshot): SnapshotReader {
  return {
    acquire: async () => success({ snapshot, release: async () => success(undefined) }),
  };
}

/** One section of the snapshot's collection in `format`. Fails with Export's diagnostic. */
async function sectionBytes(
  exporter: ExportBindings,
  snapshot: ExportSnapshot,
  format: RenderFormat,
  section: SectionId,
): Promise<Result<Uint8Array, RenderFailureSource>> {
  const artifact = await exporter.service.exportArtifact({
    identity: { collectionId: snapshot.collection.id, revision: snapshot.collection.revision },
    format,
    scope: { kind: 'section', id: section },
  });
  if (!artifact.ok) return artifact;
  return success(artifact.value.bytes);
}
