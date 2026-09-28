/*
 * Every section of a rendered document exported to its file. The PNG raster engine starts first
 * when the format needs it, then the output directory is made, then all sections are exported and
 * written at once. Pure apart from the injected exporter and files; section files are the only
 * writes. The first failure in scene order wins; the caller fixes the output path and reruns.
 */
import type { RasterEngine, SectionFiles } from '../../contract/ports/render-files.js';
import type { SectionExporter } from '../../contract/ports/render-output.js';
import type { RenderDocument } from '../../contract/records/foreign.js';
import type { RenderFormat } from '../../contract/records/render.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import { sectionId, type FilePath, type SectionId } from '../../contract/brands.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** The file ports a section export uses: the raster engine and the section files. */
interface SectionPorts {
  readonly raster: RasterEngine;
  readonly sectionFiles: SectionFiles;
}

/**
 * The written files, in scene order. Fails with `invalid-response` when the service's document
 * names a section Model would not, `provider-failed` or Export's raster failure, or the first
 * section whose export or write fails.
 */
export async function exportSections(
  format: RenderFormat,
  ports: SectionPorts,
  exporter: SectionExporter,
  document: RenderDocument,
): Promise<Result<readonly FilePath[], RenderEvidence>> {
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
): Promise<Result<void, RenderEvidence>> {
  const raster = await rasterFor(format, ports.raster);
  if (!raster.ok) return raster;
  return ports.sectionFiles.prepare();
}

/** PNG starts the raster engine; SVG needs nothing. */
function rasterFor(
  format: RenderFormat,
  raster: RasterEngine,
): Promise<Result<void, RenderEvidence>> {
  if (format !== 'png') return Promise.resolve(success(undefined));
  return raster.prepare();
}

/** Every section exported and written; the first failure in scene order wins. */
async function written(
  files: SectionFiles,
  exporter: SectionExporter,
  sections: readonly SectionId[],
): Promise<Result<readonly FilePath[], RenderEvidence>> {
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
): Promise<Result<FilePath, RenderEvidence>> {
  const bytes = await exporter.export(section);
  if (!bytes.ok) return bytes;
  return files.write(section, bytes.value);
}
