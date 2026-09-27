/*
 * The built web app's files, read from one root chosen at startup. Impure (filesystem). Only
 * passive build formats are served, and a real path must stay below the root, symlinks included.
 * A refused path answers `not-found`; the service never writes the build, so the user rebuilds the
 * web app and reloads.
 */
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { failure, success, type Result } from '../../contract/errors.js';
import type { StaticFiles } from '../../contract/ports/transport.js';
import type { StaticFile } from '../../contract/records/transport/server.js';

/** The media type of each served extension; any other extension is not a route. */
const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});

/** Binds one trusted build root; a request names a path but can never choose another root. */
export function createStaticFiles(root: string): StaticFiles {
  return { read: (path) => read(root, path) };
}

/**
 * The file at the URL path (`/` is `/index.html`). Fails with `not-found` at `file` when the path
 * is not a valid escape, leaves the root or does not exist ("build the web application first"),
 * or has an unsupported extension. A read that fails after those checks rejects; the HTTP server
 * then answers `unavailable` at `request`.
 */
async function read(
  root: string,
  pathname: string,
): Promise<Result<StaticFile>> {
  try {
    const location = await locate(root, resourcePath(pathname));
    if (!location.ok) return location;
    return load(location.value);
  } catch {
    return failure(
      'not-found',
      'file',
      'Application resource was not found; build the web application first',
    );
  }
}

/** The root document for `/`; any other path decoded once. Throws on an invalid escape. */
function resourcePath(pathname: string): string {
  if (pathname === '/') return '/index.html';
  return decodeURIComponent(pathname);
}

/**
 * The real path of `path` below the real root. Fails with `not-found` at `file` when it leaves the
 * root; throws when either path does not exist.
 */
async function locate(
  root: string,
  path: string,
): Promise<Result<string>> {
  const directory = await realpath(root);
  const file = await realpath(resolve(directory, `.${path}`));
  if (!file.startsWith(`${directory}${sep}`))
    return failure('not-found', 'file', 'Application resource was not found');
  return success(file);
}

/** The file's bytes and media type. Fails with `not-found` at `file` for an unsupported extension. */
async function load(path: string): Promise<Result<StaticFile>> {
  const mediaType = MEDIA_TYPES[extname(path)];
  if (!mediaType) return failure('not-found', 'file', 'Unsupported application resource');
  return success({ bytes: await readFile(path), mediaType });
}
