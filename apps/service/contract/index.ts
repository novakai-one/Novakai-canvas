/** Service public boundary. Web and CLI use checked requests; Authoring remains the sole mutation authority. */
export type { Result, Diagnostic, ErrorCode } from './errors.js';

export { runRenderWorker, createDiagramProducer } from './compose.js';
export type { RenderingJob, RenderDocument } from './records/rendering/job.js';
export { renderEnvelope } from './records/rendering/worker.js';
export { inspectionReport } from './records/rendering/inspection.js';
export type { InspectionReport } from './records/rendering/inspection.js';

export { prepareInstallation } from './compose.js';
export type { BuiltinResources } from './records/presets/builtins.js';

export { openWorkspace } from './compose.js';
export { serveWorkspace } from './compose.js';
export { readAgentCredential } from './compose.js';
export type { ServerOptions, LocalServer, BodyStream } from './records/transport/server.js';
export { createWorkspaceSession } from './api.js';
export type { WorkspaceSession, SessionDependencies } from './types.js';
export type { AppliedCommit } from './records/workspace/session.js';
export type { WorkspaceOptions } from './records/workspace/startup.js';
export { createHttpAdmission } from './api.js';
export type {
  Caller,
  HttpMetadata,
  HttpSecurity,
  HttpAdmission,
  MutationOwner,
} from './records/transport/http.js';
export { httpBodyLimit, browserCookieName } from './records/transport/http.js';
export { readCommand } from './api.js';
export { responseEnvelope } from './records/transport/protocol.js';
export type { TransportResponse } from './records/transport/protocol.js';
export type {
  CommandAdmission,
  AdmittedMutation,
  ApiCall,
  ApiRouter,
  WireOutcome,
} from './records/transport/protocol.js';

export { projectCollection } from './api.js';
export { createHeadlessBindings } from './compose.js';
