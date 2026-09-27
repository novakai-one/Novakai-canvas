/** Agent CLI public surface; source is readable DSL and every mutation crosses the service Authoring gate. */
export { runCli } from './compose.js';
export { formatFailure } from './api.js';
export type { Command, CliOptions } from './records/command.js';
export type { Result, CliFailure } from './errors.js';
export { runHeadless } from './compose.js';
export type { HeadlessOptions } from './records/headless.js';
export { headlessOptions } from './records/headless.js';
export type { ProfileDescriptor, ProfileFinding, ProfileLintResult } from './records/profiles.js';
