/*
 * Why this file exists
 *
 * The two programs in `cli/` need very little from the rest of the CLI: run what was typed, and
 * print a failure. `pnpm canvas list` calls `runCli`, then prints its text, or the failure as
 * lines from `formatFailure`.
 *
 * This file is all they may import. `runCli` answers `pnpm canvas` and `runRender` answers
 * `pnpm render:png`. Neither ever throws; every mistake comes back as a value.
 */
export { runCli, runRender } from './compose.js';
export { formatFailure } from './api.js';
export type { Result, CliFailure } from './errors.js';
export type { RenderReport } from './records/render.js';
export type { RenderFailure } from './records/render-failure.js';
