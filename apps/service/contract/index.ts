/**
 * The package entry point of `@novakai/canvas-service` (see package.json `exports`): only the names
 * apps/web and apps/cli import, listed explicitly.
 *
 * `projectCollection` comes from `api.ts`, the only non-compose file allowed to import core.
 * `prepareInstallation`, `readAgentCredential` and `createHeadlessBindings` come from the
 * composition root. The two envelope schemas parse service answers at the consumer edge.
 * Everything else is a type. The service's own process entries (cli/) import compose.ts directly.
 */
export { projectCollection } from './api.js';
export { prepareInstallation, readAgentCredential, createHeadlessBindings } from './compose.js';
export { responseEnvelope } from './records/transport/protocol.js';
export type { TransportResponse } from './records/transport/protocol.js';
export { renderEnvelope } from './records/rendering/worker.js';
export type { RenderingJob, RenderDocument } from './records/rendering/job.js';
export type { InspectionReport } from './records/rendering/inspection.js';
export type { BuiltinResources } from './records/presets/builtins.js';
export type { AppliedCommit } from './records/workspace/session.js';
export type { Result, Diagnostic } from './errors.js';
