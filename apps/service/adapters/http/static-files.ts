/*
 * Why this file exists
 *
 * The browser loads the web app from the service itself, so the service must hand out the built
 * app's files, and nothing else. For example, `GET /` answers the build folder's `index.html`,
 * but a path that leads outside that folder, even through a link, answers `not-found`.
 *
 * This file reads those files from the one build folder chosen at start-up. It serves only page,
 * script, style, font and image files. A missing file also answers `not-found`: build the web app
 * first. It never writes a file.
 */
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { failure, success, type Result } from '../../contract/errors.js';
import type { StaticFiles } from '../../contract/ports/transport.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type { HostPath } from '../../contract/brands.js';

/** The media type of each served extension; any other extension is not a route. */
const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});

/**
 * Makes the reader of the built web app's files in `webRoot`. A request picks a path, never the
 * folder. `read('/')` answers `index.html`.
 * Fails with `not-found` at `file` when the path leaves the folder, doesn't exist, can't be read or
 * isn't a served file type.
 */
export function createStaticFiles(webRoot: HostPath): StaticFiles {
  return { read: (path) => read(webRoot, path) };
}

/**
 * The file at the URL path (`/` is `/index.html`). Fails with `not-found` at `file` when the path
 * is not a valid escape, leaves the root, does not exist or cannot be read ("build the web
 * application first"), or has an unsupported extension. Never rejects.
 */
async function read(
  root: string,
  pathname: string,
): Promise<Result<SentFile>> {
  try {
    const location = await locate(root, resourcePath(pathname));
    if (!location.ok) return location;
    return await load(location.value);
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

/**
 * The file's bytes and media type. Fails with `not-found` at `file` for an unsupported extension;
 * throws when the file cannot be read.
 */
async function load(path: string): Promise<Result<SentFile>> {
  const mediaType = MEDIA_TYPES[extname(path)];
  if (!mediaType) return failure('not-found', 'file', 'Unsupported application resource');
  return success({ bytes: await readFile(path), mediaType });
}
