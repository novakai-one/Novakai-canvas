/*
 * Core entry points for the composition root: the only contract file that reaches core behaviour.
 * Only compose.ts, compose/ and the public index import it; no adapter or host executable does.
 * Re-exports only; pure. Each entry point's own doc names its failures.
 */

/** `pnpm canvas`: compose.ts parses and answers --help; compose/ runs every other command. */
export { parseCommand } from '../core/commands/parse.js';
export { helpText } from '../core/commands/help.js';
export { runProfileCommand, runServiceCommand } from '../core/commands/dispatch.js';
export type { ServiceCommandDependencies } from '../core/commands/dispatch.js';

/** `pnpm render:png`: compose.ts checks the argv, then runs the render over compose/render.ts. */
export { parseRenderChoice } from '../core/render/request.js';
export { renderCollection } from '../core/render/render.js';

/** Both executables print a failure through the public index. */
export { formatFailure } from '../core/diagnostics/format.js';
