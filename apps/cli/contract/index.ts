/*
 * The CLI's public surface: only what the two executables in cli/ use. `runCli` answers
 * `pnpm canvas`, `runRender` answers `pnpm render:png`, `formatFailure` turns a failure into
 * terminal lines. Both entry points return every failure as a value and never reject. Every
 * mutation crosses the service's Authoring gate; recovery after a sent request is `canvas receipt`
 * then `canvas retry`.
 */
export { runCli, runRender } from './compose.js';
export { formatFailure } from './api.js';
export type { Result, CliFailure } from './errors.js';
export type { RenderReport } from './records/render.js';
export type { RenderFailure } from './records/render-failure.js';
