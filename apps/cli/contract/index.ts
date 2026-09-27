/** Agent CLI public surface; source is readable DSL and every mutation crosses the service Authoring gate. */
export { runCli } from './compose.js';
export { formatFailure } from './api.js';
export type { Result, CliFailure } from './errors.js';
export { runHeadless } from './compose.js';
export { renderRequest } from './records/render.js';
export type { RenderReport, RenderRequest } from './records/render.js';
export type { RenderFailure } from './records/render-failure.js';
export type { ProfileDescriptor, ProfileFinding, ProfileLintResult } from './records/profiles.js';
