/*
 * The headless render's file I/O, as two ports. Input files, bound to the repo root: list the
 * shipped `.theme` and `.canvas` files under resources/, read UTF-8 text, name a recipe family's
 * shipped source. Section files, bound to the output directory and format: create the directory
 * and write section files. Read paths and the output directory are resolved against the working
 * directory. Not pure. Every failure is a `provider-failed` value, and nothing throws out of it: a
 * native failure carries the OS path, code and syscall; a path that fails its FilePath check
 * carries only the check's message.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProviderFault } from '../../contract/records/render-fault.js';
import type { RenderRequest } from '../../contract/records/render.js';
import { filePath, type FilePath, type SectionId } from '../../contract/brands.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { InputFiles, SectionFiles } from '../../contract/ports/render-files.js';
import { faulted, nativeFault, success, type Result } from '../../contract/errors.js';

/** Where one render writes its sections, and in which format. */
export type SectionTarget = Pick<RenderRequest, 'out' | 'format'>;

/** Build the input files of one render below `root`. Touches nothing and cannot fail. */
export function createInputFiles(root: FilePath): InputFiles {
  const resources = join(root, 'resources');
  return {
    shippedThemes: () => shippedThemes(resources),
    shippedCollections: () => shippedCollections(resources),
    read: (path) => readSource(path),
    recipeFile: (family) => checkedPath(join(root, 'resources/recipes', family + '.canvas')),
  };
}

/**
 * Build the section files of one render. Touches nothing and cannot fail. Output paths are made
 * absolute, so the report names absolute files.
 */
export function createSectionFiles(target: SectionTarget): SectionFiles {
  return {
    prepare: () => prepareOutput(target.out),
    write: (section, bytes) => writeSection(target, section, bytes),
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

/** Each of `paths` as a FilePath, in order. Fails as {@link checkedPath} does. */
function checkedPaths(paths: readonly string[]): Result<readonly FilePath[], ProviderFault> {
  const checked = filePath.array().safeParse(paths);
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

/**
 * The `.theme` files directly under `resources`, sorted by name. Fails with `provider-failed` when
 * the folder cannot be listed or a path fails its check.
 */
async function shippedThemes(
  resources: string,
): Promise<Result<readonly FilePath[], ProviderFault>> {
  const names = await nativeStep(() => readdir(resources));
  if (!names.ok) return names;
  const themes = names.value.filter((name) => name.endsWith('.theme')).sort();
  return checkedPaths(themes.map((name) => join(resources, name)));
}

/**
 * Every `.canvas` file anywhere under `resources`, sorted by relative path, read in parallel.
 * Fails with `provider-failed` when the folder cannot be listed, a path fails its check or a file
 * cannot be read.
 */
async function shippedCollections(
  resources: string,
): Promise<Result<readonly SourceFile[], ProviderFault>> {
  const names = await nativeStep(() => readdir(resources, { recursive: true }));
  if (!names.ok) return names;
  const canvases = names.value.filter((name) => name.endsWith('.canvas')).sort();
  const files = checkedPaths(canvases.map((name) => resolve(resources, name)));
  if (!files.ok) return files;
  return nativeStep(() => Promise.all(files.value.map(readText)));
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
  target: SectionTarget,
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
