/*
 * Confined, bounded reads of the fonts and images a source declares: the path stays inside the
 * source file's directory, the extension matches the declared kind, and at most 16 MiB is read.
 * Filesystem I/O; core decides pinned digests before calling it. Each failure is a value that
 * carries the declaration's `location`; the caller fixes that declaration or file and runs the
 * command again.
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
type Extension =
  '.png' | '.jpg' | '.jpeg' | '.webp' | '.svg' | '.ttf' | '.otf' | '.woff' | '.woff2';

/** The media type each supported file extension declares; Assets checks the bytes later. */
const media: Readonly<Record<Extension, SupportedMedia>> = Object.freeze({
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

/** Files remain local preparation inputs; retry uses retained normalized bytes and never calls this reader. */
export function createResourceReader(): ResourceReader {
  return { read };
}

/**
 * The declared file's bytes. Fails with `absolute-path`, `path-escape`, `source-unavailable`,
 * `unsupported-media`, `resource-mismatch` or `resource-too-large`, each with the declaration's
 * location.
 */
async function read(
  file: FilePath,
  request: ResourceRequest,
): Promise<Result<LocalBytes, LocalFailure>> {
  const path = await confined(file, request.source);
  if (!path.ok) return located(file, request, path.error);
  return readLocated(file, request, path.value);
}

/** A resolved location proceeds through typed media and bounded-byte admission. */
async function readLocated(
  file: FilePath,
  request: ResourceRequest,
  path: string,
): Promise<Result<LocalBytes, LocalFailure>> {
  const type = mediaType(path, request);
  if (!type.ok) return located(file, request, type.error);
  const content = await bytes(path);
  if (!content.ok) return located(file, request, content.error);
  return success({ base64: content.value.toString('base64'), mediaType: type.value });
}

/** Add the declaration's place in `file` without replacing the failure's code, message or recovery. */
function located(
  file: FilePath,
  request: ResourceRequest,
  error: LocalFailure,
): Result<never, LocalFailure> {
  const { line, column } = request.span.start;
  return failure({ ...error, location: { file, line, column, alias: request.alias } });
}

/** A path is admitted only beneath the real source directory; absolute and symlink escapes are explicit outcomes. */
async function confined(
  file: FilePath,
  source: string,
): Promise<Result<string, LocalFailure>> {
  if (isAbsolute(source))
    return failure({ code: 'absolute-path', message: 'Absolute resource paths are forbidden' });
  try {
    const root = await realpath(dirname(file));
    const path = await realpath(resolve(root, source));
    return inside(root, path);
  } catch {
    return failure({ code: 'source-unavailable', message: 'Resource path is unavailable' });
  }
}

/** Prefixes such as `..media` are ordinary child names; only an exact parent segment escapes. */
function inside(
  root: string,
  path: string,
): Result<string, LocalFailure> {
  const remainder = relative(root, path);
  if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder))
    return failure({ code: 'path-escape', message: 'Resource escapes its source directory' });
  return success(path);
}

/** Declared kind and extension must agree; Assets subsequently checks actual MIME and safe normalized content. */
function mediaType(
  path: string,
  request: ResourceRequest,
): Result<SupportedMedia, LocalFailure> {
  const extension = extname(path).toLowerCase();
  if (!isExtension(extension))
    return failure({ code: 'unsupported-media', message: 'Resource extension is unsupported' });
  const type = media[extension];
  if (!type.startsWith(expectedMedia(request.kind)))
    return failure({
      code: 'resource-mismatch',
      message: 'Resource kind and media type do not match',
    });
  return success(type);
}

/** Whether `text` is a key of the media table itself, never of its prototype. */
function isExtension(text: string): text is Extension {
  return Object.hasOwn(media, text);
}

/** Font declarations select font media; other resource declarations select images. */
function expectedMedia(kind: ResourceRequest['kind']): string {
  return kind === 'font' ? 'font/' : 'image/';
}

/** Read and cleanup preserve the first read failure; cleanup is reported when reading succeeds. */
async function bytes(path: string): Promise<Result<Buffer, LocalFailure>> {
  const opened = await openFile(path);
  if (!opened.ok) return opened;
  return readOpen(opened.value);
}

/** Open errors remain typed separately from size and media-policy failures. */
async function openFile(path: string): Promise<Result<FileHandle, LocalFailure>> {
  try {
    return success(await open(path, 'r'));
  } catch {
    return failure({ code: 'source-unavailable', message: 'Resource could not be opened' });
  }
}

/** An opened handle is always closed; the first read failure wins over a simultaneous cleanup failure. */
async function readOpen(handle: FileHandle): Promise<Result<Buffer, LocalFailure>> {
  const content = await readBounded(handle);
  const closed = await closeFile(handle);
  if (!content.ok) return content;
  if (!closed.ok) return closed;
  return content;
}

/** Read through one fixed limit-plus-one buffer until EOF or the first over-limit byte. */
async function readBounded(handle: FileHandle): Promise<Result<Buffer, LocalFailure>> {
  const buffer = Buffer.alloc(byteLimit + 1);
  const filled = await fill(handle, buffer);
  if (!filled.ok) return filled;
  if (filled.value > byteLimit)
    return failure({ code: 'resource-too-large', message: 'Resource exceeds 16 MiB' });
  return success(buffer.subarray(0, filled.value));
}

/** Native read failures become explicit outcomes without changing the fixed allocation bound. */
async function fill(
  handle: FileHandle,
  buffer: Buffer,
): Promise<Result<number, LocalFailure>> {
  let progress = { offset: 0, eof: false };
  try {
    while (!complete(progress, buffer.length))
      progress = await nextChunk(handle, buffer, progress.offset);
  } catch {
    return failure({ code: 'source-unavailable', message: 'Resource bytes could not be read' });
  }
  return success(progress.offset);
}

/** One native read advances from the prior offset; zero bytes is the only EOF signal. */
async function nextChunk(
  handle: FileHandle,
  buffer: Buffer,
  offset: number,
): Promise<{ readonly offset: number; readonly eof: boolean }> {
  const result = await handle.read(buffer, offset, buffer.length - offset, offset);
  return { offset: offset + result.bytesRead, eof: result.bytesRead === 0 };
}

/** Capacity means the explicit over-limit byte was observed; EOF means the complete file was observed. */
function complete(
  progress: { readonly offset: number; readonly eof: boolean },
  capacity: number,
): boolean {
  return progress.eof || progress.offset === capacity;
}

/** Closing is a typed cleanup outcome so a successful read cannot conceal handle uncertainty. */
async function closeFile(handle: FileHandle): Promise<Result<void, LocalFailure>> {
  try {
    await handle.close();
    return success(undefined);
  } catch {
    return failure({
      code: 'source-unavailable',
      message: 'Resource handle could not be closed safely',
    });
  }
}
