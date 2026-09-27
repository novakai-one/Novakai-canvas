/**
 * The package entry point of `@novakai/canvas-service` (see package.json `exports`). It lists the
 * 12 names apps/web and apps/cli import, plus `Result` and `Diagnostic`: the return types of
 * `prepareInstallation` and `readAgentCredential`.
 *
 * `projectCollection` comes from `api.ts`, the only non-compose file allowed to import core.
 * `prepareInstallation`, `readAgentCredential` and `createHeadlessBindings` come from the
 * composition root. The two envelope schemas parse service answers at the consumer edge.
 * `hostPath` brands the paths the CLI chooses: the two it passes to `prepareInstallation` and the
 * libavoid wasm path of its headless render jobs.
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
export type { Result, Diagnostic } from './errors.js';
export { hostPath } from './brands.js';
