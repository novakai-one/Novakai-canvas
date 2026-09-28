/*
 * Why this file exists
 *
 * Every request from the browser or the CLI arrives over HTTP at 127.0.0.1. Before any diagram code
 * runs, the server must decide: may this caller come in, which route answers, and how is the answer
 * sent? For example, `authenticate` reads a request's cookie or `Bearer` token and answers the
 * `Caller`, or refuses it.
 *
 * The socket code asks for each decision through the interfaces here; core/transport makes them.
 * Declarations only. A refused request changes nothing, so the caller can fix it and resend.
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
 * One server's address and secrets, made by adapters/credentials when it starts. `equal` compares
 * text that arrived with a secret without leaking timing (a constant-time comparison).
 */
export interface HttpSecurity {
  readonly address: LoopbackAddress;
  /** The browser's session secret, sent to it as a cookie. New on every start. */
  readonly browserSession: SessionToken;
  /**
   * The CLI's secret token, kept in the workspace's credential file. Stays the same across starts.
   */
  readonly agentToken: AgentToken;
  /** The label of this server run (see `Generation`). New on every start. */
  readonly generation: Generation;
  /** Whether the text that arrived equals the secret, compared in constant time. Never fails. */
  equal(
    untrusted: string,
    secret: string,
  ): boolean;
}

/**
 * Decides who may use the service and which changes they may send. A mutation is a request that
 * changes the workspace (`POST /api/v1/authoring/preview` or `/apply`).
 */
export interface HttpAdmission {
  /** The name of the browser's session cookie on this server. */
  readonly cookieName: string;
  /**
   * Checks that the request is the browser opening the page directly on this server (a top-level
   * navigation). Only such a request is given the session cookie. Fails with `unauthorized` at
   * `host` or `navigation`.
   */
  checkNavigation(metadata: HttpMetadata): Result<void>;
  /**
   * Works out who the request speaks for: the browser (by its session cookie) or the CLI (by its
   * token). Fails with `unauthorized` at `host`, `session` or `credential`.
   */
  authenticate(metadata: HttpMetadata): Result<Caller>;
  /**
   * Checks that the request as sent is an Authoring request this caller may send: its author is the
   * caller, and it uses a planner the caller may use. Fails with `invalid-input` at `request`, or
   * `unauthorized` at `actor` or `intent.planner`.
   */
  admitMutation(
    input: unknown,
    caller: Caller,
  ): Result<Request>;
}

/** Answers one API call from a caller that has already been let in. */
export interface ApiRouter {
  /**
   * Runs the route for `METHOD path` and answers JSON or a file. Fails with `not-found` at `route`
   * when no route matches.
   */
  invoke(call: ApiCall): Promise<RouteOutcome>;
}

/**
 * What a mutation body is checked against: who sent it, its headers, this server run and admission.
 */
export interface CommandAdmission {
  readonly caller: Caller;
  readonly metadata: HttpMetadata;
  /** This server run's label; a body made for another run is refused. */
  readonly generation: Generation;
  readonly admission: Pick<HttpAdmission, 'admitMutation'>;
}

/** Reads a mutation body into a request Authoring may run. */
export interface CommandDecoder {
  /**
   * Reads the body text as a mutation envelope and admits its request. Fails with `invalid-input`
   * at `content-type` or `body` for a malformed envelope, `conflict` at `generation` when it was
   * made for another server run, and otherwise as `HttpAdmission.admitMutation`.
   */
  read(
    body: string,
    context: CommandAdmission,
  ): Result<AdmittedMutation>;
}

/**
 * The decisions core/transport makes for the socket code. The socket code keeps the rest: limits,
 * timers, request order, fixed headers and content types.
 */
export interface TransportPolicy {
  /** The request's method and headers, read from the socket and not yet trusted. */
  head(
    method: string | undefined,
    headers: HeaderLists,
  ): HttpMetadata;
  /** The body as text: size-limited, and refused unless it is valid UTF-8. */
  body(chunks: AsyncIterable<unknown>): Promise<Result<string>>;
  /** Which part of the server answers `METHOD path`: the change stream, the API or the web app. */
  kind(
    method: string,
    path: string,
  ): RequestKind;
  /** Every value sent for each query key, in order. */
  query(params: URLSearchParams): ApiQuery;
  /** The HTTP status for an answer. */
  status(outcome: WireOutcome): HttpStatus;
  /** The JSON body for an answer, with its version and this server run's label. */
  envelope(
    outcome: WireOutcome,
    generation: Generation,
  ): TransportResponse;
  /** Whether a web app file may be served, and the session cookie a direct page open is given. */
  browserAccess(metadata: HttpMetadata): Result<BrowserGrant>;
  /** The text of each message on the change stream. */
  readonly frames: EventFrames;
}

/** The text of each message on the change stream (server-sent events). */
export interface EventFrames {
  /** The first message on every connection. Cannot fail. */
  connected(generation: Generation): string;
  /** The message sent after each saved change, carrying that change. Cannot fail. */
  committed(
    generation: Generation,
    change: CommittedChange,
  ): string;
  /** A comment line sent now and then so an idle connection stays open. */
  readonly keepalive: string;
}

/** The built web app's files, read from one folder chosen at start-up. */
export interface StaticFiles {
  /** Reads the file at one URL path. Fails with `not-found` at `file`; never rejects. */
  read(path: string): Promise<Result<StaticFile>>;
}

/** What the HTTP server is started with. compose/serve.ts builds each part once. */
export interface ServerBindings {
  readonly security: Pick<HttpSecurity, 'address' | 'generation'>;
  readonly admission: Pick<HttpAdmission, 'authenticate'>;
  readonly router: ApiRouter;
  readonly policy: TransportPolicy;
  readonly files: StaticFiles;
  /** Where the change stream listens for saved changes. */
  readonly changes: Pick<WorkspaceSession, 'subscribe'>;
}
