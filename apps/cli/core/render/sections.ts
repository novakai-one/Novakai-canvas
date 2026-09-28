/*
 * Why this file exists
 *
 * A collection with sections `intro` and `data` becomes two image files in the `--out` folder:
 * `intro.png` and `data.png`. Before any is written, the PNG engine has to start (for PNG only)
 * and the folder has to exist.
 *
 * This file checks each section ID, starts the PNG engine if needed, makes the folder, then has
 * Export draw each section and writes its file. Each step gives back a `Result` (see
 * `contract/errors.ts`). Section files are the only thing it writes.
 */
import type { RasterEngine, SectionFiles } from '../../contract/ports/render-files.js';
import type { SectionExporter } from '../../contract/ports/render-output.js';
import type { RenderDocument } from '../../contract/records/foreign.js';
import type { RenderFormat } from '../../contract/records/render.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import { sectionId, type FilePath, type SectionId } from '../../contract/brands.js';
import { failure, success, type LocalFailure, type Result } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** What writing sections needs: the PNG engine (`raster`) and the section file writer. */
interface SectionPorts {
  readonly raster: RasterEngine;
  readonly sectionFiles: SectionFiles;
}

/** One section of the laid-out drawing, with its ID as plain text. */
type SceneSection = RenderDocument['scene']['sections'][number];

/**
 * Writes each section of `document` to its own file in `format` (`svg` or `png`), and gives back
 * the files' paths in the order the sections are drawn.
 * Mistakes: a section ID that isn't valid (a broken service answer), the PNG engine or the folder
 * failing, or Export or the write failing for a section.
 */
export async function exportSections(
  format: RenderFormat,
  ports: SectionPorts,
  exporter: SectionExporter,
  document: RenderDocument,
): Promise<Result<readonly FilePath[], RenderFailureSource>> {
  const sections = checkSectionIds(document);
  if (!sections.ok) {
    return sections;
  }
  const ready = await prepareOutput(format, ports);
  if (!ready.ok) {
    return ready;
  }
  return writeSections(ports.sectionFiles, exporter, sections.value);
}

/** Checks the ID of every section the document draws, in drawing order. */
function checkSectionIds(document: RenderDocument): Result<readonly SectionId[]> {
  const checkedIds = document.scene.sections.map(checkSectionId);
  return combined(checkedIds);
}

/**
 * Checks one drawn section's ID as Model's `SectionId`. Layout keeps it as plain text, but it comes
 * from the collection Model checked, so only a broken service answer fails here.
 */
function checkSectionId(section: SceneSection): Result<SectionId> {
  const id = sectionId.safeParse(section.id);
  if (!id.success) {
    return invalidSectionIdFailure(section.id);
  }
  return success(id.data);
}

/** Starts the PNG engine when the format is PNG, then makes the `--out` folder. */
async function prepareOutput(
  format: RenderFormat,
  ports: SectionPorts,
): Promise<Result<void, RenderFailureSource>> {
  const engine = await startEngineFor(format, ports.raster);
  if (!engine.ok) {
    return engine;
  }
  return ports.sectionFiles.makeOutFolder();
}

/** Starts the PNG engine for PNG. SVG needs no engine. */
async function startEngineFor(
  format: RenderFormat,
  raster: RasterEngine,
): Promise<Result<void, RenderFailureSource>> {
  if (format === 'png') {
    return raster.prepare();
  }
  return success(undefined);
}

/**
 * Has Export draw every section and writes each to its file, all at once. Gives back the files'
 * paths, or the first failure in drawing order.
 */
async function writeSections(
  files: SectionFiles,
  exporter: SectionExporter,
  sections: readonly SectionId[],
): Promise<Result<readonly FilePath[], RenderFailureSource>> {
  const writing = sections.map((section) => writeSection(files, exporter, section));
  const written = await Promise.all(writing);
  return combined(written);
}

/** Has Export draw one section, then writes its bytes to the section's file. */
async function writeSection(
  files: SectionFiles,
  exporter: SectionExporter,
  section: SectionId,
): Promise<Result<FilePath, RenderFailureSource>> {
  const bytes = await exporter.export(section);
  if (!bytes.ok) {
    return bytes;
  }
  return files.write(section, bytes.value);
}

/** Makes the mistake for a drawn section whose ID isn't a section ID (`invalid-response`). */
function invalidSectionIdFailure(id: string): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: `Rendered section is not a section ID: ${id}`,
  });
}
