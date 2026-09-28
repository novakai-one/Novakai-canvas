/*
 * Why this file exists
 *
 * The web app and the CLI use the service, but they may import only from `@novakai/canvas-service`,
 * and that name points here. For example, the CLI calls `readAgentCredential` to find its token,
 * and both check every service answer with `transportResponse`. The web app also checks stored
 * generations with `generation`; the CLI checks `canvas inspect` answers with `inspectionReport`.
 *
 * This file lists everything they may import: a few functions and checks, the types those return,
 * and the failure types the web keeps (`ErrorCode`, `CapabilityFailure`). Anything else is private
 * to the service. The service's own start files in `cli/` import `compose.ts` instead.
 */
export { projectCollection, validReport } from './api.js';
export { prepareBuiltins, readAgentCredential, createHeadlessBindings } from './compose.js';
export { transportResponse } from './records/transport/protocol.js';
export type { TransportResponse } from './records/transport/protocol.js';
export type { CapabilityFailure } from './records/transport/failure-source.js';
export { renderDocumentMessage } from './records/rendering/worker.js';
export type { RenderingJob, RenderDocument } from './records/rendering/job.js';
export { inspectionReport } from './records/rendering/inspection.js';
export type { InspectionReport } from './records/rendering/inspection.js';
export type { PreparedBuiltins } from './records/presets/builtins.js';
export type { Result, Diagnostic, ErrorCode } from './errors.js';
export { hostPath, generation } from './brands.js';
export type { Generation } from './brands.js';
