/*
 * Why this file exists
 *
 * A source can name a font or image next to it: `asset @logo image source="./assets/logo.png"`.
 * Reading that file must not let a source reach anything else on the machine, such as
 * `../../secrets` or a link that points outside its folder.
 *
 * This file reads such a file only from inside the source's folder, only when its extension fits
 * what was declared (a font or an image), and at most 16 MiB. It never checks the bytes
 * themselves; Assets does that later. Mistakes come back as values, never thrown.
 */
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname, sep } from 'node:path';
import type { ResourceRequest, SupportedMedia } from '../../contract/records/foreign.js';
import type { LocalBytes } from '../../contract/records/staged-resource.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import type { FilePath } from '../../contract/brands.js';

/** The most bytes one resource may have. */
const byteLimit = 16 * 1024 * 1024;

/** A file extension the reader accepts, lowercase. */
type KnownExtension =
  '.png' | '.jpg' | '.jpeg' | '.webp' | '.svg' | '.ttf' | '.otf' | '.woff' | '.woff2';

/** The media type each supported file extension declares; Assets checks the bytes later. */
const extensionMedia: Readonly<Record<KnownExtension, SupportedMedia>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

/** The real paths, with every link followed, of the source file's folder and of the resource. */
interface RealPaths {
  readonly sourceFolder: string;
  readonly resourcePath: string;
}

/** How far a read has got: the bytes read so far, and whether the last read found the end. */
interface ReadProgress {
  readonly byteCount: number;
  readonly ended: boolean;
}

/**
 * Gives core its careful font and image file reader. A retry never uses it: it sends the bytes
 * kept in the request journal instead.
 */
export function createResourceReader(): ResourceReader {
  return { read: readResource };
}

/** Reads a declared font or image, once its real path is known to stay in the source's folder. */
async function readResource(
  file: FilePath,
  request: ResourceRequest,
): Promise<Result<LocalBytes, LocalFailure>> {
  const resourcePath = await confinePath(file, request.source);
  if (!resourcePath.ok) {
    return resourcePath;
  }
  return readConfinedResource(resourcePath.value, request);
}

/** Checks the file's extension fits the declaration, then reads its bytes as base64 text. */
async function readConfinedResource(
  resourcePath: string,
  request: ResourceRequest,
): Promise<Result<LocalBytes, LocalFailure>> {
  const mediaType = checkMediaType(resourcePath, request.kind);
  if (!mediaType.ok) {
    return mediaType;
  }
  const bytes = await readResourceBytes(resourcePath);
  if (!bytes.ok) {
    return bytes;
  }
  const base64 = bytes.value.toString('base64');
  return success({ base64, mediaType: mediaType.value });
}

/** Finds the resource's real path and checks it stays inside the source file's folder. */
async function confinePath(
  file: FilePath,
  source: string,
): Promise<Result<string, LocalFailure>> {
  if (isAbsolute(source)) {
    return absolutePathFailure();
  }
  const realPaths = await findRealPaths(file, source);
  if (!realPaths.ok) {
    return realPaths;
  }
  return checkInsideSourceFolder(realPaths.value);
}

/** Finds the real paths of the source file's folder and of the resource, following every link. */
async function findRealPaths(
  file: FilePath,
  source: string,
): Promise<Result<RealPaths, LocalFailure>> {
  try {
    const sourceFolder = await realpath(dirname(file));
    const resourcePath = await realpath(resolve(sourceFolder, source));
    return success({ sourceFolder, resourcePath });
  } catch {
    return sourceUnavailableFailure('Resource path is unavailable');
  }
}

/** Checks the resource sits inside the source file's folder, and gives its real path. */
function checkInsideSourceFolder(realPaths: RealPaths): Result<string, LocalFailure> {
  if (leavesSourceFolder(realPaths)) {
    return pathEscapeFailure();
  }
  return success(realPaths.resourcePath);
}

/** Whether the resource lies outside the folder. A child named `..media` is still inside. */
function leavesSourceFolder(realPaths: RealPaths): boolean {
  const pathFromFolder = relative(realPaths.sourceFolder, realPaths.resourcePath);
  const climbsOut = pathFromFolder === '..' || pathFromFolder.startsWith(`..${sep}`);
  const onAnotherDrive = isAbsolute(pathFromFolder);
  return climbsOut || onAnotherDrive;
}

/** Works out the media type the file's extension names, and checks it fits the declared kind. */
function checkMediaType(
  resourcePath: string,
  kind: ResourceRequest['kind'],
): Result<SupportedMedia, LocalFailure> {
  const extension = extname(resourcePath).toLowerCase();
  if (!isKnownExtension(extension)) {
    return unsupportedMediaFailure();
  }
  const mediaType = extensionMedia[extension];
  const expectedPrefix = expectedMediaPrefix(kind);
  if (!mediaType.startsWith(expectedPrefix)) {
    return resourceMismatchFailure();
  }
  return success(mediaType);
}

/** Whether `text` is a key of the media table itself, never of its prototype. */
function isKnownExtension(text: string): text is KnownExtension {
  return Object.hasOwn(extensionMedia, text);
}

/** Gives the media type a declaration expects: `font/` for a font, `image/` for anything else. */
function expectedMediaPrefix(kind: ResourceRequest['kind']): string {
  return kind === 'font' ? 'font/' : 'image/';
}

/** Opens the file, reads at most 16 MiB of it, and closes it again. */
async function readResourceBytes(resourcePath: string): Promise<Result<Buffer, LocalFailure>> {
  const openedFile = await openResource(resourcePath);
  if (!openedFile.ok) {
    return openedFile;
  }
  return readThenClose(openedFile.value);
}

/** Opens the file for reading. */
async function openResource(resourcePath: string): Promise<Result<FileHandle, LocalFailure>> {
  try {
    const openedFile = await open(resourcePath, 'r');
    return success(openedFile);
  } catch {
    return sourceUnavailableFailure('Resource could not be opened');
  }
}

/** Reads the open file, then always closes it. A read mistake is reported before a close one. */
async function readThenClose(openedFile: FileHandle): Promise<Result<Buffer, LocalFailure>> {
  const bytes = await readWithinLimit(openedFile);
  const closed = await closeResource(openedFile);
  if (!bytes.ok) {
    return bytes;
  }
  if (!closed.ok) {
    return closed;
  }
  return bytes;
}

/** Reads the file into a buffer one byte over the limit, and refuses a file that fills it. */
async function readWithinLimit(openedFile: FileHandle): Promise<Result<Buffer, LocalFailure>> {
  const buffer = Buffer.alloc(byteLimit + 1);
  const byteCount = await fillBuffer(openedFile, buffer);
  if (!byteCount.ok) {
    return byteCount;
  }
  if (byteCount.value > byteLimit) {
    return resourceTooLargeFailure();
  }
  const bytes = buffer.subarray(0, byteCount.value);
  return success(bytes);
}

/** Reads the file into the buffer until it ends or the buffer is full, and gives the byte count. */
async function fillBuffer(
  openedFile: FileHandle,
  buffer: Buffer,
): Promise<Result<number, LocalFailure>> {
  try {
    const byteCount = await readUntilEndOrFull(openedFile, buffer);
    return success(byteCount);
  } catch {
    return sourceUnavailableFailure('Resource bytes could not be read');
  }
}

/** Reads chunk after chunk into the buffer, and gives how many bytes it holds. May throw. */
async function readUntilEndOrFull(
  openedFile: FileHandle,
  buffer: Buffer,
): Promise<number> {
  let progress: ReadProgress = { byteCount: 0, ended: false };
  while (shouldReadMore(progress, buffer.length)) {
    progress = await readNextChunk(openedFile, buffer, progress.byteCount);
  }
  return progress.byteCount;
}

/** Whether to read again: the last read didn't find the end, and the buffer still has room. */
function shouldReadMore(
  progress: ReadProgress,
  capacity: number,
): boolean {
  return !progress.ended && progress.byteCount < capacity;
}

/** Reads the next chunk into the buffer at `offset`. A read that gives no bytes found the end. */
async function readNextChunk(
  openedFile: FileHandle,
  buffer: Buffer,
  offset: number,
): Promise<ReadProgress> {
  const room = buffer.length - offset;
  const chunk = await openedFile.read(buffer, offset, room, offset);
  const byteCount = offset + chunk.bytesRead;
  const ended = chunk.bytesRead === 0;
  return { byteCount, ended };
}

/** Closes the file, reporting a close that fails, so a good read can't hide it. */
async function closeResource(openedFile: FileHandle): Promise<Result<void, LocalFailure>> {
  try {
    await openedFile.close();
    return success(undefined);
  } catch {
    return sourceUnavailableFailure('Resource handle could not be closed safely');
  }
}

/** Makes the mistake for a resource path that starts at the root of the disk (`absolute-path`). */
function absolutePathFailure(): Result<never, LocalFailure> {
  return failure({ code: 'absolute-path', message: 'Absolute resource paths are forbidden' });
}

/** Makes the mistake for a resource that can't be found, opened, read or closed. */
function sourceUnavailableFailure(message: string): Result<never, LocalFailure> {
  return failure({ code: 'source-unavailable', message });
}

/** Makes the mistake for a resource outside the source file's folder (`path-escape`). */
function pathEscapeFailure(): Result<never, LocalFailure> {
  return failure({ code: 'path-escape', message: 'Resource escapes its source directory' });
}

/** Makes the mistake for an extension that isn't a known font or image (`unsupported-media`). */
function unsupportedMediaFailure(): Result<never, LocalFailure> {
  return failure({ code: 'unsupported-media', message: 'Resource extension is unsupported' });
}

/** Makes the mistake for a font declared with an image file, or the reverse. */
function resourceMismatchFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'resource-mismatch',
    message: 'Resource kind and media type do not match',
  });
}

/** Makes the mistake for a resource file over 16 MiB (`resource-too-large`). */
function resourceTooLargeFailure(): Result<never, LocalFailure> {
  return failure({ code: 'resource-too-large', message: 'Resource exceeds 16 MiB' });
}
