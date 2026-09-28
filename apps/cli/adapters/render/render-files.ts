/*
 * Why this file exists
 *
 * A render reads and writes files. `--collection states --out out/` reads the shipped `.canvas`
 * files to find `states`, then writes `out/<section>.svg` for each section. Core decides which
 * files, but can't touch the disk.
 *
 * This file does that reading, below the repo folder, and that writing, only into `--out`. A
 * relative path is taken from the folder the command runs in. Every mistake is `provider-failed`,
 * with Node's details of what went wrong, given back as a value.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProviderFault } from '../../contract/records/render-fault.js';
import type { RenderFormat, RenderRequest } from '../../contract/records/render.js';
import { filePath, type FilePath, type SectionId } from '../../contract/brands.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { InputFiles, SectionFiles } from '../../contract/ports/render-files.js';
import type { RecipeFamily } from '../../contract/records/foreign.js';
import { providerFailure, success, type Result } from '../../contract/errors.js';

/** Where one render writes its section images (`--out`), and in which format (`--format`). */
export type SectionTarget = Pick<RenderRequest, 'out' | 'format'>;

/** The characters a section's file name may not hold: all but letters, digits, `_` and `-`. */
const unsafeNameCharacters = /[^a-zA-Z0-9_-]/g;

/** Gives the render its file reads; shipped files are found below `repoRoot`. Reads nothing yet. */
export function createInputFiles(repoRoot: FilePath): InputFiles {
  const resourcesFolder = join(repoRoot, 'resources');
  return {
    shippedThemes: () => listShippedThemes(resourcesFolder),
    shippedCollections: () => readShippedCollections(resourcesFolder),
    read: readSourceFile,
    recipeFile: (family) => recipeFilePath(repoRoot, family),
  };
}

/**
 * Gives the render its section image writer, for `target`'s folder and format. Section `intro`
 * becomes `<out>/intro.svg`; each written path comes back absolute. Writes nothing yet.
 */
export function createSectionFiles(target: SectionTarget): SectionFiles {
  return {
    makeOutFolder: () => makeOutFolder(target.out),
    write: (section, bytes) => writeSection(target, section, bytes),
  };
}

/** Lists the `.theme` files directly in the shipped resources folder, sorted by name. */
async function listShippedThemes(
  resourcesFolder: string,
): Promise<Result<readonly FilePath[], ProviderFault>> {
  const fileNames = await runFileStep(() => readdir(resourcesFolder));
  if (!fileNames.ok) {
    return fileNames;
  }
  const themeNames = fileNames.value.filter(isThemeFile).sort();
  const themePaths = themeNames.map((name) => join(resourcesFolder, name));
  return checkedPaths(themePaths);
}

/** Reads every `.canvas` file anywhere under the shipped resources folder, all at once. */
async function readShippedCollections(
  resourcesFolder: string,
): Promise<Result<readonly SourceFile[], ProviderFault>> {
  const canvasFiles = await listShippedCanvasFiles(resourcesFolder);
  if (!canvasFiles.ok) {
    return canvasFiles;
  }
  return runFileStep(() => readEveryText(canvasFiles.value));
}

/** Lists every `.canvas` file anywhere under the shipped resources folder, sorted by path. */
async function listShippedCanvasFiles(
  resourcesFolder: string,
): Promise<Result<readonly FilePath[], ProviderFault>> {
  const relativePaths = await runFileStep(() => readdir(resourcesFolder, { recursive: true }));
  if (!relativePaths.ok) {
    return relativePaths;
  }
  const canvasNames = relativePaths.value.filter(isCanvasFile).sort();
  const canvasPaths = canvasNames.map((name) => resolve(resourcesFolder, name));
  return checkedPaths(canvasPaths);
}

/** Reads one file's UTF-8 text, taking a relative path from the folder the command runs in. */
async function readSourceFile(path: FilePath): Promise<Result<SourceFile, ProviderFault>> {
  const file = absolutePath(path);
  if (!file.ok) {
    return file;
  }
  return runFileStep(() => readText(file.value));
}

/** Gives the path of a recipe family's shipped source, such as `resources/recipes/er.canvas`. */
function recipeFilePath(
  repoRoot: FilePath,
  family: RecipeFamily,
): Result<FilePath, ProviderFault> {
  const recipePath = join(repoRoot, 'resources/recipes', `${family}.canvas`);
  return checkedPath(recipePath);
}

/** Makes the `--out` folder, and any missing folders above it. An existing one is kept. */
async function makeOutFolder(out: FilePath): Promise<Result<void, ProviderFault>> {
  const folder = absolutePath(out);
  if (!folder.ok) {
    return folder;
  }
  return runFileStep(() => makeFolder(folder.value));
}

/** Writes one section's image bytes to `<out>/<section>.<format>`, and gives that absolute path. */
async function writeSection(
  target: SectionTarget,
  section: SectionId,
  bytes: Uint8Array,
): Promise<Result<FilePath, ProviderFault>> {
  const fileName = sectionFileName(section, target.format);
  const sectionPath = join(target.out, fileName);
  const file = absolutePath(sectionPath);
  if (!file.ok) {
    return file;
  }
  return runFileStep(() => writeBytes(file.value, bytes));
}

/** Gives a section's file name, such as `intro.svg` for section `intro` drawn as SVG. */
function sectionFileName(
  section: SectionId,
  format: RenderFormat,
): string {
  const safeName = section.replace(unsafeNameCharacters, '-');
  return `${safeName}.${format}`;
}

/** Runs one file step, and turns a throw into `provider-failed` with Node's details. */
async function runFileStep<T>(step: () => Promise<T>): Promise<Result<T, ProviderFault>> {
  try {
    const stepOutput = await step();
    return success(stepOutput);
  } catch (thrown) {
    return providerFailure(thrown);
  }
}

/** Resolves a path against the folder the command runs in, and checks it as a `FilePath`. */
function absolutePath(path: string): Result<FilePath, ProviderFault> {
  const resolved = resolve(path);
  return checkedPath(resolved);
}

/**
 * Checks a path as a `FilePath`. Node's path functions never give an empty path, so this can't
 * fail in practice; if it did, it would be `provider-failed` with the check's message.
 */
function checkedPath(path: string): Result<FilePath, ProviderFault> {
  const checked = filePath.safeParse(path);
  if (!checked.success) {
    return providerFailure(checked.error);
  }
  return success(checked.data);
}

/** Checks each path as a `FilePath`, in order, as `checkedPath` does. */
function checkedPaths(paths: readonly string[]): Result<readonly FilePath[], ProviderFault> {
  const checked = filePath.array().safeParse(paths);
  if (!checked.success) {
    return providerFailure(checked.error);
  }
  return success(checked.data);
}

/** Whether a file name is a `.theme` file. */
function isThemeFile(name: string): boolean {
  return name.endsWith('.theme');
}

/** Whether a file name is a `.canvas` file. */
function isCanvasFile(name: string): boolean {
  return name.endsWith('.canvas');
}

/** Reads every file's UTF-8 text at once. Throws Node's first read error. */
function readEveryText(files: readonly FilePath[]): Promise<SourceFile[]> {
  const reads = files.map(readText);
  return Promise.all(reads);
}

/** Reads one file's UTF-8 text, kept with its path. Throws Node's read error. */
async function readText(file: FilePath): Promise<SourceFile> {
  const source = await readFile(file, 'utf8');
  return { source, path: file };
}

/** Makes the folder and any missing folders above it. Throws Node's error. */
async function makeFolder(folder: FilePath): Promise<void> {
  await mkdir(folder, { recursive: true });
}

/** Writes the bytes to the file, replacing it, and gives the file's path. Throws Node's error. */
async function writeBytes(
  file: FilePath,
  bytes: Uint8Array,
): Promise<FilePath> {
  await writeFile(file, bytes);
  return file;
}
