/*
 * The CLI's public surface: the entry points of `pnpm canvas` and `pnpm render:png`, the failure
 * formatter and the records they print. Every mutation crosses the service's Authoring gate.
 */
export { runCli, runRender } from './compose.js';
export { formatFailure } from './api.js';
export type { Result, CliFailure } from './errors.js';
export type { RenderReport } from './records/render.js';
export type { RenderFailure } from './records/render-failure.js';
