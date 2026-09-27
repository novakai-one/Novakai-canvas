/*
 * Core entry points for the composition root and the render wiring: the only contract file that
 * reaches core behaviour. Re-exports only; pure. Each entry point names its own failures.
 */
export { execute as executeCommand } from '../core/commands/dispatch.js';

export { usage } from '../core/commands/help.js';

export { parseCommand } from '../core/commands/parse.js';

export { executeProfile } from '../core/profiles/commands.js';

export { readThemeSource } from '../core/themes/grammar.js';

export { formatFailure } from '../core/diagnostics/format.js';

export { parseRenderRequest } from '../core/render/request.js';

export { RenderAbort, accepted, evidence } from '../core/render/faults.js';

export { retainedResources, resourceInspector } from '../core/render/snapshot.js';

export { assetAttribution, sourceMatches, sourceWithTheme } from '../core/render/source-theme.js';

export { renderReport } from '../core/render/report.js';
