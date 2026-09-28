/*
 * Why this file exists
 *
 * The web app and the CLI use the service, but they may import only from `@novakai/canvas-service`,
 * and that name points here. For example, the CLI calls `readAgentCredential` to find its token,
 * and both check every service answer with `transportResponse`. The web app also checks drawn
 * diagrams with `renderDocumentMessage` and builds catalog entries with `projectCollection`.
 *
 * This file lists everything they may import: a few functions and checks, and the types those
 * return. Anything not listed here is private to the service. The service's own start files in
 * `cli/` import `compose.ts` instead.
 */
export { projectCollection } from './api.js';
export { prepareBuiltins, readAgentCredential, createHeadlessBindings } from './compose.js';
export { transportResponse } from './records/transport/protocol.js';
export type { TransportResponse } from './records/transport/protocol.js';
export { renderDocumentMessage } from './records/rendering/worker.js';
export type { RenderingJob, RenderDocument } from './records/rendering/job.js';
export type { InspectionReport } from './records/rendering/inspection.js';
export type { PreparedBuiltins } from './records/presets/builtins.js';
export type { Result, Diagnostic } from './errors.js';
export { hostPath } from './brands.js';
