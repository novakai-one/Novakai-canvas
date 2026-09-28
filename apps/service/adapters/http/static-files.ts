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

/** The file `/` asks for. */
const INDEX_PAGE = '/index.html';

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
 * `read` fails with `not-found` at `file` when the path leaves the folder, doesn't exist, can't be
 * read or isn't a served file type.
 */
export function createStaticFiles(webRoot: HostPath): StaticFiles {
  return { read: (path) => readWebAppFile(webRoot, path) };
}

/**
 * Reads the built file the URL path names. Any problem, a bad escape or a missing file included,
 * answers `not-found`; it never rejects.
 */
async function readWebAppFile(
  root: string,
  pathname: string,
): Promise<Result<SentFile>> {
  try {
    const requestedPath = decodeRequestPath(pathname);
    const location = await locateInsideRoot(root, requestedPath);
    if (!location.ok) {
      return location;
    }
    return await loadServedFile(location.value);
  } catch {
    return missingResourceFailure();
  }
}

/** Works out the file path the URL asks for: `/` asks for `/index.html`; others are decoded once. */
function decodeRequestPath(pathname: string): string {
  if (pathname === '/') {
    return INDEX_PAGE;
  }
  return decodeURIComponent(pathname);
}

/**
 * Finds the file's real path, links followed, and checks it is inside the real root. Throws when
 * the root or the file doesn't exist.
 */
async function locateInsideRoot(
  root: string,
  requestedPath: string,
): Promise<Result<string>> {
  const realRoot = await realpath(root);
  const realFile = await realpath(resolve(realRoot, `.${requestedPath}`));
  if (!isInsideFolder(realFile, realRoot)) {
    return outsideRootFailure();
  }
  return success(realFile);
}

/** Whether the path is somewhere below the folder. */
function isInsideFolder(
  path: string,
  folder: string,
): boolean {
  const folderPrefix = `${folder}${sep}`;
  return path.startsWith(folderPrefix);
}

/** Reads a served file's bytes, with its media type. Throws when the file can't be read. */
async function loadServedFile(path: string): Promise<Result<SentFile>> {
  const mediaType = MEDIA_TYPES[extname(path)];
  if (mediaType === undefined) {
    return unsupportedResourceFailure();
  }
  const bytes = await readFile(path);
  const servedFile: SentFile = { bytes, mediaType };
  return success(servedFile);
}

/** Makes the mistake for a file that is missing or can't be read: the web app isn't built. */
function missingResourceFailure(): Result<never> {
  return failure(
    'not-found',
    'file',
    'Application resource was not found; build the web application first',
  );
}

/** Makes the mistake for a path that leads outside the build folder. */
function outsideRootFailure(): Result<never> {
  return failure('not-found', 'file', 'Application resource was not found');
}

/** Makes the mistake for a file type that is never served. */
function unsupportedResourceFailure(): Result<never> {
  return failure('not-found', 'file', 'Unsupported application resource');
}
