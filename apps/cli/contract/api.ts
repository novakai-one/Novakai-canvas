/*
 * Core entry points for the composition root: the only contract file that reaches core behaviour.
 * Re-exports only; pure. Each entry point names its own failures.
 */
export { executeProfile, executeService } from '../core/commands/dispatch.js';

export type { ServicePorts } from '../core/commands/dispatch.js';

export { usage } from '../core/commands/help.js';

export { parseCommand } from '../core/commands/parse.js';

export { formatFailure } from '../core/diagnostics/format.js';

export { parseRenderChoice } from '../core/render/request.js';

export { renderCollection } from '../core/render/render.js';
