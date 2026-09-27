import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname, sep } from 'node:path';
import type { ResourceRequest } from '@novakai/canvas-language';
import type { ResourceFiles, LocalInput } from '../../contract/records/resources.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
const byteLimit = 16 * 1024 * 1024;
const media: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
/** A path is admitted only beneath the real source directory; absolute and symlink escapes are explicit outcomes. */
async function confined(
  file: string,
  source: string,
): Promise<Result<string>> {
  if (isAbsolute(source)) return failure('absolute-path', 'Absolute resource paths are forbidden');
  try {
    const root = await realpath(dirname(file));
    const path = await realpath(resolve(root, source));
    return inside(root, path);
  } catch {
    return failure('source-unavailable', 'Resource path is unavailable');
  }
}
/** Prefixes such as `..media` are ordinary child names; only an exact parent segment escapes. */
function inside(
  root: string,
  path: string,
): Result<string> {
  const remainder = relative(root, path);
  if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder))
    return failure('path-escape', 'Resource escapes its source directory');
  return { ok: true, value: path };
}
/** Open errors remain typed separately from size and media-policy failures. */
async function openFile(path: string): Promise<Result<FileHandle>> {
  try {
    return { ok: true, value: await open(path, 'r') };
  } catch {
    return failure('source-unavailable', 'Resource could not be opened');
  }
}
/** Read through one fixed limit-plus-one buffer until EOF or the first over-limit byte. */
async function readBounded(handle: FileHandle): Promise<Result<Buffer>> {
  const buffer = Buffer.alloc(byteLimit + 1);
  const filled = await fill(handle, buffer);
  if (!filled.ok) return filled;
  if (filled.value > byteLimit) return failure('resource-too-large', 'Resource exceeds 16 MiB');
  return { ok: true, value: buffer.subarray(0, filled.value) };
}
/** Native read failures become explicit outcomes without changing the fixed allocation bound. */
async function fill(
  handle: FileHandle,
  buffer: Buffer,
): Promise<Result<number>> {
  let progress = { offset: 0, eof: false };
  try {
    while (!complete(progress, buffer.length))
      progress = await nextChunk(handle, buffer, progress.offset);
  } catch {
    return failure('source-unavailable', 'Resource bytes could not be read');
  }
  return { ok: true, value: progress.offset };
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
) {
  return progress.eof || progress.offset === capacity;
}
/** Closing is a typed cleanup outcome so a successful read cannot conceal handle uncertainty. */
async function closeFile(handle: FileHandle): Promise<Result<void>> {
  try {
    await handle.close();
    return { ok: true, value: undefined };
  } catch {
    return failure('source-unavailable', 'Resource handle could not be closed safely');
  }
}
/** Read and cleanup preserve the first read failure; cleanup is reported when reading succeeds. */
async function bytes(path: string): Promise<Result<Buffer>> {
  const opened = await openFile(path);
  if (!opened.ok) return opened;
  return readOpen(opened.value);
}
/** An opened handle is always closed; the first read failure wins over a simultaneous cleanup failure. */
async function readOpen(handle: FileHandle): Promise<Result<Buffer>> {
  const read = await readBounded(handle);
  const closed = await closeFile(handle);
  if (!read.ok) return read;
  if (!closed.ok) return closed;
  return read;
}
/** Declared kind and extension must agree; Assets subsequently checks actual MIME and safe normalized content. */
function mediaType(
  path: string,
  request: ResourceRequest,
): Result<string> {
  const type = media[extname(path).toLowerCase()];
  if (!type) return failure('unsupported-media', 'Resource extension is unsupported');
  if (!type.startsWith(expectedMedia(request.kind)))
    return failure('resource-mismatch', 'Resource kind and media type do not match');
  return { ok: true, value: type };
}
/** Pinned digests deliberately bypass filesystem reads; local failures retain source/span/alias context. */
async function read(
  file: string,
  request: ResourceRequest,
): Promise<Result<LocalInput>> {
  if (/^sha256:[a-f0-9]{64}$/.test(request.source))
    return {
      ok: true,
      value: { alias: request.alias, digest: request.source.slice(7), stage: null },
    };
  const path = await confined(file, request.source);
  if (!path.ok) return contextual(file, request, path.error);
  return readLocated(file, request, path.value);
}
/** A resolved location proceeds through typed media and bounded-byte admission. */
async function readLocated(
  file: string,
  request: ResourceRequest,
  path: string,
): Promise<Result<LocalInput>> {
  const type = mediaType(path, request);
  if (!type.ok) return contextual(file, request, type.error);
  const content = await bytes(path);
  if (!content.ok) return contextual(file, request, content.error);
  return localInput(request, type.value, content.value);
}
/** Successful filesystem preparation returns only normalized staging input, never an authoritative binding. */
function localInput(
  request: ResourceRequest,
  mediaType: string,
  buffer: Buffer,
): Result<LocalInput> {
  return {
    ok: true,
    value: {
      alias: request.alias,
      digest: null,
      stage: {
        base64: buffer.toString('base64'),
        mediaType,
        alt: request.alt ?? request.alias,
        provenance: {
          source: request.source,
          ...Object.fromEntries(
            Object.entries({ license: request.license, attribution: request.attribution }).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        },
      },
    },
  };
}
/** Add source location without replacing the stable failure code or recovery instruction. */
function contextual<T>(
  file: string,
  request: ResourceRequest,
  error: Diagnostic,
): Result<T> {
  const location = `${file}:${request.span.start.line}:${request.span.start.column} asset @${request.alias}`;
  return { ok: false, error: { ...error, message: `${location}: ${error.message}` } };
}
/** Files remain local preparation inputs; retry uses retained normalized bytes and never calls this reader. */
export function createResourceFiles(): ResourceFiles {
  return { read };
}

/** Font declarations select font media; other resource declarations select images. */
function expectedMedia(kind: ResourceRequest['kind']): string {
  return kind === 'font' ? 'font/' : 'image/';
}
