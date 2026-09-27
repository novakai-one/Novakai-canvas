/*
 * The headless render's file I/O, bound to one repo root, output directory and format: list the
 * shipped `.theme` and `.canvas` files under resources/, read UTF-8 text, name a recipe family's
 * shipped source, create the output directory and write section files. Not pure. Every failure is
 * a `provider-failed` value carrying the OS path, code and syscall.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  nativeFault,
  type HeadlessOptions,
  type ProviderFault,
} from '../../contract/records/headless.js';
import { filePath, type FilePath, type SectionId } from '../../contract/brands.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { RenderFiles } from '../../contract/ports/render.js';
import type { Result } from '../../contract/errors.js';

/** Where one render reads shipped files and writes its sections. */
export type RenderTarget = Pick<HeadlessOptions, 'root' | 'out' | 'format'>;

/** Build the render file adapter for one render. Raster start-up is bound separately. */
export function createRenderFiles(target: RenderTarget): Omit<RenderFiles, 'prepareRaster'> {
  const resources = join(target.root, 'resources');
  return {
    shippedThemes: () => nativeStep(() => shippedThemes(resources)),
    shippedCollections: () => nativeStep(() => shippedCollections(resources)),
    read: (path) => nativeStep(() => read(path)),
    recipeFile: (family) =>
      filePath.parse(join(target.root, 'resources/recipes', family + '.canvas')),
    prepareOutput: () => nativeStep(() => createDirectory(target.out)),
    writeSection: (section, bytes) => nativeStep(() => writeSection(target, section, bytes)),
  };
}

/** Run one filesystem step. A throw becomes a `provider-failed` failure value. */
async function nativeStep<T>(step: () => Promise<T>): Promise<Result<T, ProviderFault>> {
  try {
    return { ok: true, value: await step() };
  } catch (error) {
    return { ok: false, error: nativeFault(error) };
  }
}

/** The `.theme` files directly under `resources`, sorted by name. */
async function shippedThemes(resources: string): Promise<readonly FilePath[]> {
  const names = (await readdir(resources)).filter((name) => name.endsWith('.theme')).sort();
  return names.map((name) => filePath.parse(join(resources, name)));
}

/** Every `.canvas` file anywhere under `resources`, sorted by relative path, read in parallel. */
async function shippedCollections(resources: string): Promise<readonly SourceFile[]> {
  const names = (await readdir(resources, { recursive: true }))
    .filter((name) => name.endsWith('.canvas'))
    .sort();
  return Promise.all(names.map((name) => read(filePath.parse(join(resources, name)))));
}

/** One file's UTF-8 text, with its path resolved against the working directory. */
async function read(path: FilePath): Promise<SourceFile> {
  const file = filePath.parse(resolve(path));
  return { source: await readFile(file, 'utf8'), file };
}

/** Create the directory and any missing parents; an existing one is kept. */
async function createDirectory(path: FilePath): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Write to `<out>/<section>.<format>`; characters outside `[a-zA-Z0-9_-]` in the ID become `-`. */
async function writeSection(
  target: RenderTarget,
  section: SectionId,
  bytes: Uint8Array,
): Promise<FilePath> {
  const file = join(target.out, section.replace(/[^a-zA-Z0-9_-]/g, '-') + '.' + target.format);
  await writeFile(file, bytes);
  return filePath.parse(file);
}
