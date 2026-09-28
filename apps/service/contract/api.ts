/*
 * Why this file exists
 *
 * The web app lists and searches every collection in its library panel. For that it needs each
 * collection as a catalog entry, built exactly as the service builds it: `projectCollection`.
 *
 * That function lives in service core, and files in `contract/` may not import core. This file is
 * the one exception, so `index.ts` can pass `projectCollection` on. It exports nothing else.
 */
export { projectCollection } from '../core/workspace/collection-projection.js';
