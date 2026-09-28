/**
 * The package entry point of `@novakai/canvas-service` (see package.json `exports`). It lists the
 * 18 names apps/web and apps/cli import, plus `Result` and `Diagnostic`: the return types of
 * `prepareInstallation` and `readAgentCredential`.
 *
 * `projectCollection` (web) and `validReport` (CLI) come from `api.ts`, the only non-compose file
 * allowed to import core. `prepareInstallation`, `readAgentCredential` and
 * `createHeadlessBindings` come from the composition root. The two envelope schemas parse service
 * answers at the consumer edge; `inspectionReport` checks the CLI's inspect answer.
 * `hostPath` brands the paths the CLI chooses: the two it passes to `prepareInstallation` and the
 * libavoid wasm path of its headless render jobs. `generation` is the schema the web's readers
 * parse stored transport generations with.
 * Everything else is a type; `ErrorCode` and `OperationSource` type the web's service failures.
 * The service's own process entries (cli/) import compose.ts directly.
 */
export { projectCollection, validReport } from './api.js';
export { prepareInstallation, readAgentCredential, createHeadlessBindings } from './compose.js';
export { responseEnvelope } from './records/transport/protocol.js';
export type { TransportResponse } from './records/transport/protocol.js';
export type { OperationSource } from './records/transport/failure-source.js';
export { renderEnvelope } from './records/rendering/worker.js';
export type { RenderingJob, RenderDocument } from './records/rendering/job.js';
export { inspectionReport } from './records/rendering/inspection.js';
export type { InspectionReport } from './records/rendering/inspection.js';
export type { BuiltinResources } from './records/presets/builtins.js';
export type { Result, Diagnostic, ErrorCode } from './errors.js';
export { hostPath, generation } from './brands.js';
export type { Generation } from './brands.js';
