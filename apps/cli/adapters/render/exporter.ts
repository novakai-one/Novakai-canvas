/*
 * Why this file exists
 *
 * Once the service has laid a collection out, each section still has to become image bytes:
 * `--format svg` makes one SVG per section. Export does that, and it draws each box and wire with
 * Presentation, which must load the drawing's fonts first.
 *
 * This file sets Export up for one render: its format, its `--labels` choice, then the laid-out
 * collection. It writes no file; `core/render/sections.ts` does. Mistakes come back as values.
 */
import { createReactBindings, type ReactBindings } from '@novakai/canvas-presentation';
import {
  composeExport,
  type ExportBindings,
  type ExportOwners,
  type SnapshotLease,
  type SnapshotReader,
} from '@novakai/canvas-export';
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
import type { CollectionId, SectionId } from '../../contract/brands.js';
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

/** What the render asks Export for: one section of a collection at one revision, in one format. */
interface SectionRequest {
  readonly identity: { readonly collectionId: CollectionId; readonly revision: number };
  readonly format: RenderFormat;
  readonly scope: { readonly kind: 'section'; readonly id: SectionId };
}

/** No stylesheet: Export only embeds one in HTML, and a render makes SVG or PNG. */
const noReaderCss = '';

/**
 * Gives the render its `prepareExporter` step, which sets Export up with `choices` for one
 * drawing. That step fails only if Presentation can't load one of the drawing's fonts.
 */
export function createExporter(choices: ExportChoices): Pick<RenderOutput, 'prepareExporter'> {
  return { prepareExporter: (input) => prepareExporter(input, choices) };
}

/** Loads the drawing's fonts into Presentation, then sets Export up to draw each section. */
async function prepareExporter(
  input: ExportInput,
  choices: ExportChoices,
): Promise<Result<SectionExporter, RenderFailureSource>> {
  const presentation = await createReactBindings(input.document.fonts);
  if (!presentation.ok) {
    return presentation;
  }
  const exportSetup = setUpExport(presentation.value, input, choices);
  const exportBindings = composeExport(exportSetup);
  const sectionExporter = exporterOfSections(exportBindings, input.snapshot, choices.format);
  return success(sectionExporter);
}

/** Gathers what Export is set up with: the fonts, the `--labels` choice and the collection. */
function setUpExport(
  presentation: ReactBindings,
  input: ExportInput,
  choices: ExportChoices,
): ExportOwners {
  const drawsEveryLabel = choices.labels === 'all';
  return {
    presentation,
    readerCss: noReaderCss,
    allLabels: drawsEveryLabel,
    snapshots: readerOfOneSnapshot(input.snapshot),
    documents: choices.documentsFor(input.resolvedResources),
    resources: input.resources,
  };
}

/** Makes the section exporter: it draws one section of the snapshot in the render's format. */
function exporterOfSections(
  exportBindings: ExportBindings,
  snapshot: ExportSnapshot,
  format: RenderFormat,
): SectionExporter {
  return { export: (section) => exportSection(exportBindings, snapshot, format, section) };
}

/** Makes a snapshot reader that always hands Export this render's one snapshot. */
function readerOfOneSnapshot(snapshot: ExportSnapshot): SnapshotReader {
  return { acquire: () => lendSnapshot(snapshot) };
}

/** Lends Export the snapshot. Giving it back does nothing: it is only held in memory. */
async function lendSnapshot(snapshot: ExportSnapshot): Promise<Result<SnapshotLease, never>> {
  return success({ snapshot, release: releaseNothing });
}

/** Gives a lent snapshot back, which needs nothing done. */
async function releaseNothing(): Promise<Result<void, never>> {
  return success(undefined);
}

/** Draws one section of the snapshot's collection as image bytes in `format`. */
async function exportSection(
  exportBindings: ExportBindings,
  snapshot: ExportSnapshot,
  format: RenderFormat,
  section: SectionId,
): Promise<Result<Uint8Array, RenderFailureSource>> {
  const exportRequest = sectionRequest(snapshot, format, section);
  const artifact = await exportBindings.service.exportArtifact(exportRequest);
  if (!artifact.ok) {
    return artifact;
  }
  return success(artifact.value.bytes);
}

/** Makes Export's request for one section of the snapshot's collection, at its revision. */
function sectionRequest(
  snapshot: ExportSnapshot,
  format: RenderFormat,
  section: SectionId,
): SectionRequest {
  const identity = { collectionId: snapshot.collection.id, revision: snapshot.collection.revision };
  return { identity, format, scope: { kind: 'section', id: section } };
}
