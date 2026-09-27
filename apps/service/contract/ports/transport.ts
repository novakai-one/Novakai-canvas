/*
 * The seams of the HTTP server (adapters/http/server.ts) and its API: the server's security
 * secrets, the ingress admission, the API router and command decoder, the transport policy it asks
 * for request decisions, the static files it serves and the bindings it is started with.
 * Declarations only; core/transport implements admission, routing and policy, adapters implement
 * the secrets and files, and compose/serve.ts binds them. A refused request is the caller's to
 * correct and resend; Authoring owns commit and receipt recovery.
 */
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import type { Request } from '../records/capabilities.js';
import type { CommittedChange } from './notifications.js';
import type { Caller, HeaderLists, HttpMetadata } from '../records/transport/http.js';
import type {
  AdmittedMutation,
  ApiCall,
  RouteOutcome,
  TransportResponse,
  WireOutcome,
} from '../records/transport/protocol.js';
import type {
  BrowserGrant,
  HttpStatus,
  RequestKind,
  StaticFile,
} from '../records/transport/server.js';

/**
 * One server's loopback address and secrets. The host keeps the tokens and supplies `equal`, a
 * constant-time comparison of untrusted text with a secret.
 */
export interface HttpSecurity {
  readonly host: string;
  readonly origin: string;
  readonly browserSession: string;
  readonly agentToken: string;
  readonly generation: string;
  equal(
    left: string,
    right: string,
  ): boolean;
}

/**
 * The ingress policy (core/transport/admission.ts). Restart changes generation and browser
 * credential, while the persisted agent credential stays local.
 */
export interface HttpAdmission {
  readonly cookieName: string;
  bootstrap(metadata: HttpMetadata): Result<void>;
  authenticate(metadata: HttpMetadata): Result<Caller>;
  mutation(
    input: unknown,
    caller: Caller,
  ): Result<Request>;
}

/** Answers one authenticated API call. */
export interface ApiRouter {
  invoke(call: ApiCall): Promise<RouteOutcome>;
}

/** What a mutation body is decoded against: the caller, its head, the generation and admission. */
export interface CommandAdmission {
  readonly caller: Caller;
  readonly metadata: HttpMetadata;
  readonly generation: string;
  readonly ingress: Pick<HttpAdmission, 'mutation'>;
}

/** Decodes a mutation body into an admitted Authoring request. */
export interface CommandDecoder {
  read(
    body: string,
    context: CommandAdmission,
  ): Result<AdmittedMutation>;
}

/**
 * The request decisions core/transport makes for the server. The server keeps its socket limits,
 * heartbeat, request order, fixed header tables, content types and status 200 for bytes and events.
 */
export interface TransportPolicy {
  /** The untrusted head admission reads, from the method and the raw header lists. */
  head(
    method: string | undefined,
    headers: HeaderLists,
  ): HttpMetadata;
  /** The body text, bounded and strict UTF-8, from the socket's chunk stream. */
  body(chunks: AsyncIterable<unknown>): Promise<Result<string>>;
  /** Which part answers `METHOD path`. */
  kind(
    method: string,
    path: string,
  ): RequestKind;
  /** The query values a route reads. */
  query(params: URLSearchParams): ApiCall['query'];
  /** The HTTP status of an outcome. */
  status(outcome: WireOutcome): HttpStatus;
  /** The versioned JSON body of an outcome. */
  envelope(
    outcome: WireOutcome,
    generation: string,
  ): TransportResponse;
  /** Whether a web app request may be served, and the session cookie a navigation receives. */
  browserAccess(metadata: HttpMetadata): Result<BrowserGrant>;
  /** The server-sent event frames of the change stream. */
  readonly frames: EventFrames;
}

/** The text of each server-sent event frame. */
export interface EventFrames {
  connected(generation: string): string;
  committed(
    generation: string,
    change: CommittedChange,
  ): string;
  readonly keepalive: string;
}

/** The built web app, read from one root chosen at startup. */
export interface StaticFiles {
  read(path: string): Promise<Result<StaticFile>>;
}

/** What the HTTP server is started with; compose/serve.ts binds each member once. */
export interface ServerBindings {
  readonly security: Pick<HttpSecurity, 'origin' | 'generation'>;
  readonly admission: Pick<HttpAdmission, 'authenticate'>;
  readonly router: ApiRouter;
  readonly policy: TransportPolicy;
  readonly files: StaticFiles;
  readonly changes: Pick<WorkspaceSession, 'subscribe'>;
}
