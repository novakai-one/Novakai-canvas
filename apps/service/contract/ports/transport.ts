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
import type { AgentToken, Generation, SessionToken } from '../brands.js';
import type {
  Caller,
  HeaderLists,
  HttpMetadata,
  LoopbackAddress,
} from '../records/transport/http.js';
import type {
  AdmittedMutation,
  ApiCall,
  ApiQuery,
  RouteOutcome,
  TransportResponse,
} from '../records/transport/protocol.js';
import type { HttpStatus, WireOutcome } from '../records/transport/wire-codes.js';
import type { BrowserGrant, RequestKind, StaticFile } from '../records/transport/server.js';

/**
 * One server's loopback address and secrets, minted by adapters/credentials. The host keeps the
 * tokens and supplies `equal`, a constant-time comparison of untrusted text with a secret.
 */
export interface HttpSecurity {
  readonly address: LoopbackAddress;
  readonly browserSession: SessionToken;
  readonly agentToken: AgentToken;
  readonly generation: Generation;
  /** Whether untrusted text equals a secret, compared in constant time. Never fails. */
  equal(
    untrusted: string,
    secret: string,
  ): boolean;
}

/**
 * The ingress policy (core/transport/admission.ts). Restart changes generation and browser
 * credential, while the persisted agent credential stays local.
 */
export interface HttpAdmission {
  /** The browser session cookie name for this host. */
  readonly cookieName: string;
  /**
   * Whether a request may receive the browser credential: only a direct, top-level navigation.
   * Fails with `unauthorized` at `host` or `navigation`.
   */
  bootstrap(metadata: HttpMetadata): Result<void>;
  /**
   * The caller a request speaks for. Fails with `unauthorized` at `host`, `session` or
   * `credential`.
   */
  authenticate(metadata: HttpMetadata): Result<Caller>;
  /**
   * The input as an Authoring request this caller may submit. Fails with `invalid-input` at
   * `request`, or `unauthorized` at `actor` or `intent.planner`.
   */
  mutation(
    input: unknown,
    caller: Caller,
  ): Result<Request>;
}

/** Answers one authenticated API call. */
export interface ApiRouter {
  /**
   * Runs the handler of `METHOD path`; its answer is JSON or a file. Fails with `not-found` at
   * `route` when no route key matches.
   */
  invoke(call: ApiCall): Promise<RouteOutcome>;
}

/** What a mutation body is decoded against: the caller, its head, the generation and admission. */
export interface CommandAdmission {
  readonly caller: Caller;
  readonly metadata: HttpMetadata;
  readonly generation: Generation;
  readonly ingress: Pick<HttpAdmission, 'mutation'>;
}

/** Decodes a mutation body into an admitted Authoring request. */
export interface CommandDecoder {
  /**
   * Fails with `invalid-input` at `content-type` or `body` for a malformed envelope, `conflict` at
   * `generation` for another transport generation, and otherwise as `HttpAdmission.mutation`.
   */
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
  /** Every value given for each query key, in order. */
  query(params: URLSearchParams): ApiQuery;
  /** The HTTP status of an outcome. */
  status(outcome: WireOutcome): HttpStatus;
  /** The versioned JSON body of an outcome. */
  envelope(
    outcome: WireOutcome,
    generation: Generation,
  ): TransportResponse;
  /** Whether a web app request may be served, and the session cookie a navigation receives. */
  browserAccess(metadata: HttpMetadata): Result<BrowserGrant>;
  /** The server-sent event frames of the change stream. */
  readonly frames: EventFrames;
}

/** The text of each server-sent event frame. */
export interface EventFrames {
  /** The first frame on every connection. Cannot fail. */
  connected(generation: Generation): string;
  /** The frame sent after each commit, carrying the committed change. Cannot fail. */
  committed(
    generation: Generation,
    change: CommittedChange,
  ): string;
  /** A comment line that holds an idle connection open. */
  readonly keepalive: string;
}

/** The built web app, read from one root chosen at startup. */
export interface StaticFiles {
  /** The file at one URL path. Fails with `not-found` at `file`; never rejects. */
  read(path: string): Promise<Result<StaticFile>>;
}

/** What the HTTP server is started with; compose/serve.ts binds each member once. */
export interface ServerBindings {
  readonly security: Pick<HttpSecurity, 'address' | 'generation'>;
  readonly admission: Pick<HttpAdmission, 'authenticate'>;
  readonly router: ApiRouter;
  readonly policy: TransportPolicy;
  readonly files: StaticFiles;
  readonly changes: Pick<WorkspaceSession, 'subscribe'>;
}
