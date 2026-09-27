/*
 * Export for one headless render: Presentation's React drawing over the document's fonts, and
 * Export composed over a lease that always hands back the one snapshot, the documents port and
 * the snapshot's resource inspector. Each section exports in the request's format and label mode.
 * Pure apart from Presentation's font loading. Failures are values; core/render/render.ts owns
 * recovery.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import { composeExport, type ExportBindings, type SnapshotReader } from '@novakai/canvas-export';
import type { ExportInput, SectionExporter } from '../ports/render.js';
import type { RenderEvidence } from '../records/render-failure.js';
import type { LabelMode, RenderFormat } from '../records/render.js';
import type { ExportSnapshot, Language } from '../records/foreign.js';
import type { SectionId } from '../brands.js';
import { success, type Result } from '../errors.js';
import { exportDocuments } from './render-documents.js';

/** What Export needs from the render besides one snapshot. */
export interface ExportChoices {
  readonly format: RenderFormat;
  readonly labels: LabelMode;
  /** Prints and lowers DSL for the documents port. */
  readonly language: Pick<Language, 'lower' | 'print'>;
}

/**
 * Export over `input`'s snapshot, drawing with the document's fonts. Fails with Presentation's
 * font failure.
 */
export async function openExporter(
  input: ExportInput,
  choices: ExportChoices,
): Promise<Result<SectionExporter, RenderEvidence>> {
  const presentation = await createReactBindings(input.document.fonts);
  if (!presentation.ok) return presentation;
  const exporter = composeExport({
    presentation: presentation.value,
    readerCss: '',
    allLabels: choices.labels === 'all',
    snapshots: lease(input.snapshot),
    documents: exportDocuments(choices.language, input.pins),
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
): Promise<Result<Uint8Array, RenderEvidence>> {
  const artifact = await exporter.service.exportArtifact({
    identity: { collectionId: snapshot.collection.id, revision: snapshot.collection.revision },
    format,
    scope: { kind: 'section', id: section },
  });
  if (!artifact.ok) return artifact;
  return success(artifact.value.bytes);
}
