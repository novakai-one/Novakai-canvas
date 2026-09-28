/*
 * Export for one headless render: Presentation's React drawing over the document's fonts, and
 * Export composed over a lease that always hands back the one snapshot, the injected documents
 * port and the snapshot's resource inspector. Each section exports in the request's format and
 * label mode. Pure apart from Presentation's font loading. Failures are values;
 * core/render/render.ts owns recovery.
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

/** What Export needs from the render besides one snapshot. */
export interface ExportChoices {
  readonly format: RenderFormat;
  readonly labels: LabelMode;
  /** The documents port Export reads, prints and parses collections through, over `pins`. */
  documentsFor(pins: ResolvedResources): Documents;
}

/** The output port's Export. Cannot fail; `prepareExporter` fails as {@link openExporter}. */
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
