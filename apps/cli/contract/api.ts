/*
 * Why this file exists
 *
 * Core does the CLI's thinking, but it can't open a file or a connection. The setup code
 * (`compose.ts` and `compose/`) is where real files and connections are plugged in, and it is the
 * only code that may start core. For `pnpm canvas list`, it calls `parseCommand`, then
 * `runServiceCommand`.
 *
 * This file is that one door into core: it passes on core's entry points and nothing else. The
 * code that touches files and the network (`adapters/`) never imports it.
 */

/**
 * `pnpm canvas`: check the typed line, then give the help text or run a profile or service command
 * (`runProfileCommand`, `runServiceCommand`). `ServiceCommandDependencies` is every tool a service
 * command may use, such as the service's calls and the file reader.
 */
export { parseCommand } from '../core/commands/parse.js';
export { helpText } from '../core/commands/help.js';
export { runProfileCommand, runServiceCommand } from '../core/commands/dispatch.js';
export type { ServiceCommandDependencies } from '../core/commands/dispatch.js';

/** `pnpm render:png`: check the typed flags, then draw the collection. */
export { parseRenderChoice } from '../core/render/request.js';
export { renderCollection } from '../core/render/render.js';

/** Both programs: turn a failure into lines to print. */
export { formatFailure } from '../core/diagnostics/format.js';
