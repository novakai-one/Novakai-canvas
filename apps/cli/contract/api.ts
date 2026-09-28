/*
 * Why this file exists
 *
 * Core does the CLI's thinking, and only `compose.ts` and `compose/` may start it. They need one
 * door into core. For `pnpm canvas list`, compose calls `parseCommand`, then `runServiceCommand`.
 *
 * This file is that door: it passes on core's entry points and nothing else. No adapter imports
 * it. Each entry point's own comment says what it gives back and what can go wrong.
 */

/** `pnpm canvas`: check the typed line, then answer with the help text or run the command. */
export { parseCommand } from '../core/commands/parse.js';
export { helpText } from '../core/commands/help.js';
export { runProfileCommand, runServiceCommand } from '../core/commands/dispatch.js';
export type { ServiceCommandDependencies } from '../core/commands/dispatch.js';

/** `pnpm render:png`: check the typed flags, then draw the collection. */
export { parseRenderChoice } from '../core/render/request.js';
export { renderCollection } from '../core/render/render.js';

/** Both programs: turn a failure into lines to print. */
export { formatFailure } from '../core/diagnostics/format.js';
