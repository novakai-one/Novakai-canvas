/*
 * Why this file exists
 *
 * The web app lists and searches every collection in its library panel. For that it needs each
 * collection as a catalog entry, built exactly as the service builds it: `projectCollection`. The
 * CLI's `pnpm render:png` reports on its drawing exactly as `canvas inspect` does: `validReport`.
 *
 * Both live in service core, and files in `contract/` may not import core. This file is the one
 * exception, so `index.ts` can pass them on. It exports nothing else. (Every package names this
 * file `api.ts`; the public list itself is `index.ts`.)
 */
export { projectCollection } from '../core/workspace/collection-projection.js';
export { validReport } from '../core/rendering/inspection.js';
