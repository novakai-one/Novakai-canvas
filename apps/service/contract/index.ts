/** Service public boundary. Web and CLI use checked requests; Authoring remains the sole mutation authority. */
export type { Result, Diagnostic, ErrorCode } from './errors.js';

export { runRenderWorker, createDiagramProducer } from './compose.js';
export type { RenderingJob, RenderDocument } from './records/rendering.js';
export { renderEnvelope } from './records/worker.js';
export { inspectionReport } from './records/inspection.js';
export type { InspectionReport } from './records/inspection.js';

export { prepareInstallation } from './compose.js';
export type { BuiltinResources } from './records/builtins.js';

export { openWorkspace } from './compose.js';
export { serveWorkspace } from './compose.js';
export { readAgentCredential } from './compose.js';
export type { ServerOptions, LocalServer, BodyStream } from './records/server.js';
export { createWorkspaceSession } from './api.js';
export type { WorkspaceSession, SessionDependencies } from './types.js';
export type { AppliedCommit } from './records/applied-commit.js';
export type { WorkspaceOptions } from './records/startup.js';
export { createHttpAdmission } from './api.js';
export type {
  Caller,
  HttpMetadata,
  HttpSecurity,
  HttpAdmission,
  MutationOwner,
} from './records/http.js';
export { httpBodyLimit, browserCookieName } from './records/http.js';
export { readCommand } from './api.js';
export { responseEnvelope } from './records/protocol.js';
export type { TransportResponse } from './records/protocol.js';
export type {
  CommandAdmission,
  AdmittedMutation,
  ApiCall,
  ApiRouter,
  WireOutcome,
} from './records/protocol.js';

export { projectCollection } from './api.js';
export { createHeadlessBindings } from './compose.js';
