/*
 * The headless render's file I/O, bound to one repo root, output directory and format: list the
 * shipped `.theme` and `.canvas` files under resources/, read UTF-8 text, name a recipe family's
 * shipped source, create the output directory and write section files. Read paths and the output
 * directory are resolved against the working directory. Not pure. Every failure is a
 * `provider-failed` value carrying the OS path, code and syscall; nothing throws out of it.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProviderFault } from '../../contract/records/provider-fault.js';
import type { RenderRequest } from '../../contract/records/render.js';
import { filePath, type FilePath, type SectionId } from '../../contract/brands.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { RenderFiles } from '../../contract/ports/render.js';
import { faulted, nativeFault, success, type Result } from '../../contract/errors.js';

/** Where one render reads shipped files and writes its sections. */
export type RenderTarget = Pick<RenderRequest, 'root' | 'out' | 'format'>;

/**
 * Build the render file adapter for one render. Touches nothing and cannot fail. Output paths are
 * made absolute, so the report names absolute files. Raster start-up is bound separately.
 */
export function createRenderFiles(target: RenderTarget): Omit<RenderFiles, 'prepareRaster'> {
  const resources = join(target.root, 'resources');
  return {
    shippedThemes: () => nativeStep(() => shippedThemes(resources)),
    shippedCollections: () => nativeStep(() => shippedCollections(resources)),
    read: (path) => readSource(path),
    recipeFile: (family) => checkedPath(join(target.root, 'resources/recipes', family + '.canvas')),
    prepareOutput: () => prepareOutput(target.out),
    writeSection: (section, bytes) => writeSection(target, section, bytes),
  };
}

/**
 * `path` as a FilePath. Node's path functions never return an empty path, so this cannot fail in
 * practice; if it did, it fails with `provider-failed` carrying the check's message.
 */
function checkedPath(path: string): Result<FilePath, ProviderFault> {
  const checked = filePath.safeParse(path);
  if (!checked.success) return faulted(nativeFault(checked.error));
  return success(checked.data);
}

/** `path` resolved against the working directory. Fails as {@link checkedPath} does. */
function absolute(path: string): Result<FilePath, ProviderFault> {
  return checkedPath(resolve(path));
}

/** Run one filesystem step. A throw becomes a `provider-failed` failure value. */
async function nativeStep<T>(step: () => Promise<T>): Promise<Result<T, ProviderFault>> {
  try {
    return { ok: true, value: await step() };
  } catch (error) {
    return { ok: false, error: nativeFault(error) };
  }
}

/** The `.theme` files directly under `resources`, sorted by name. Throws; run as a native step. */
async function shippedThemes(resources: string): Promise<readonly FilePath[]> {
  const names = (await readdir(resources)).filter((name) => name.endsWith('.theme')).sort();
  return names.map((name) => filePath.parse(join(resources, name)));
}

/**
 * Every `.canvas` file anywhere under `resources`, sorted by relative path, read in parallel.
 * Throws; run as a native step.
 */
async function shippedCollections(resources: string): Promise<readonly SourceFile[]> {
  const names = (await readdir(resources, { recursive: true }))
    .filter((name) => name.endsWith('.canvas'))
    .sort();
  return Promise.all(names.map((name) => readText(filePath.parse(resolve(resources, name)))));
}

/**
 * One file's UTF-8 text, with its path resolved against the working directory. Fails with
 * `provider-failed` when the path fails its check or the file cannot be read.
 */
async function readSource(path: FilePath): Promise<Result<SourceFile, ProviderFault>> {
  const file = absolute(path);
  if (!file.ok) return file;
  return nativeStep(() => readText(file.value));
}

/** The UTF-8 text of an absolute `file`. Throws the native read error. */
async function readText(file: FilePath): Promise<SourceFile> {
  return { source: await readFile(file, 'utf8'), file };
}

/**
 * The output directory, made absolute and created with any missing parents. Fails with
 * `provider-failed` when the path fails its check or the directory cannot be made.
 */
async function prepareOutput(out: FilePath): Promise<Result<void, ProviderFault>> {
  const directory = absolute(out);
  if (!directory.ok) return directory;
  return nativeStep(() => createDirectory(directory.value));
}

/** Create the directory and any missing parents; an existing one is kept. Throws the native error. */
async function createDirectory(path: FilePath): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Write to `<out>/<section>.<format>` and return that absolute path; characters outside
 * `[a-zA-Z0-9_-]` in the ID become `-`. Fails with `provider-failed` when the path fails its check
 * or the file cannot be written.
 */
async function writeSection(
  target: RenderTarget,
  section: SectionId,
  bytes: Uint8Array,
): Promise<Result<FilePath, ProviderFault>> {
  const name = section.replace(/[^a-zA-Z0-9_-]/g, '-') + '.' + target.format;
  const file = absolute(join(target.out, name));
  if (!file.ok) return file;
  return nativeStep(() => writeBytes(file.value, bytes));
}

/** Write `bytes` to `file`, replacing it. Throws the native write error. */
async function writeBytes(
  file: FilePath,
  bytes: Uint8Array,
): Promise<FilePath> {
  await writeFile(file, bytes);
  return file;
}
