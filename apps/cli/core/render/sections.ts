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
import { failure, success, type Result } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** What writing sections needs: the PNG engine (`raster`) and the section file writer. */
interface SectionPorts {
  readonly raster: RasterEngine;
  readonly sectionFiles: SectionFiles;
}

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
  const sections = combined(document.scene.sections.map((section) => checkedSection(section.id)));
  if (!sections.ok) return sections;
  const ready = await prepared(format, ports);
  if (!ready.ok) return ready;
  return written(ports.sectionFiles, exporter, sections.value);
}

/**
 * One scene section's ID as Model's SectionId. Layout keeps it as plain text; it comes from the
 * Model-checked collection, so this fails (`invalid-response`) only on a broken service answer.
 */
function checkedSection(id: string): Result<SectionId> {
  const checked = sectionId.safeParse(id);
  if (!checked.success)
    return failure({
      code: 'invalid-response',
      message: `Rendered section is not a section ID: ${id}`,
    });
  return success(checked.data);
}

/** The raster engine when the format is PNG, then the output directory. Fails as either does. */
async function prepared(
  format: RenderFormat,
  ports: SectionPorts,
): Promise<Result<void, RenderFailureSource>> {
  const raster = await rasterFor(format, ports.raster);
  if (!raster.ok) return raster;
  return ports.sectionFiles.makeOutFolder();
}

/** PNG starts the raster engine; SVG needs nothing. */
function rasterFor(
  format: RenderFormat,
  raster: RasterEngine,
): Promise<Result<void, RenderFailureSource>> {
  if (format !== 'png') return Promise.resolve(success(undefined));
  return raster.prepare();
}

/** Every section exported and written; the first failure in scene order wins. */
async function written(
  files: SectionFiles,
  exporter: SectionExporter,
  sections: readonly SectionId[],
): Promise<Result<readonly FilePath[], RenderFailureSource>> {
  const results = await Promise.all(
    sections.map((section) => writtenSection(files, exporter, section)),
  );
  return combined(results);
}

/** One section's bytes written to its file. Fails with Export's or the write's failure. */
async function writtenSection(
  files: SectionFiles,
  exporter: SectionExporter,
  section: SectionId,
): Promise<Result<FilePath, RenderFailureSource>> {
  const bytes = await exporter.export(section);
  if (!bytes.ok) return bytes;
  return files.write(section, bytes.value);
}
