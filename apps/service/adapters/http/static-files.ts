import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { StaticFile, StaticFiles } from '../../contract/records/transport/server.js';
/** A checked real path must remain below the built root, including when an installation contains symlinks. */
async function locate(
  root: string,
  path: string,
): Promise<Result<string>> {
  const directory = await realpath(root);
  const file = await realpath(resolve(directory, `.${path}`));
  if (!file.startsWith(`${directory}${sep}`))
    return failure('not-found', 'file', 'Application resource was not found');
  return { ok: true, value: file };
}
/** Only passive build formats are served. Repository sources, credentials and arbitrary document types are not routes. */
async function read(
  root: string,
  pathname: string,
): Promise<Result<StaticFile>> {
  try {
    const path = resourcePath(pathname);
    const location = await locate(root, path);
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
/** The root document is explicit; other routes are decoded once before real-path confinement. */
function resourcePath(pathname: string): string {
  if (pathname === '/') return '/index.html';
  return decodeURIComponent(pathname);
}
/** Missing/invalid build files produce typed failures; restarting the service never overwrites the build. */
async function load(path: string): Promise<Result<StaticFile>> {
  const media: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  const mediaType = media[extname(path)];
  if (!mediaType) return failure('not-found', 'file', 'Unsupported application resource');
  return { ok: true, value: { bytes: await readFile(path), mediaType } };
}
/** Bind one trusted build root; callers can request resources but cannot select another filesystem root. */
export function createStaticFiles(root: string): StaticFiles {
  return { read: (path) => read(root, path) };
}
