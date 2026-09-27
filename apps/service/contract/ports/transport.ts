/*
 * The seams of the HTTP server (adapters/http/server.ts): the transport policy it asks for each
 * decision, the static files it serves and the bindings it is started with. Declarations only;
 * core/transport implements the policy and compose/serve.ts binds it. A refused request is the
 * caller's to correct and resend; Authoring owns commit and receipt recovery.
 */
import type { WorkspaceSession } from '../types.js';
import type { Result } from '../errors.js';
import type { CommittedChange } from './notifications.js';
import type {
  HeaderLists,
  HttpAdmission,
  HttpMetadata,
  HttpSecurity,
} from '../records/transport/http.js';
import type {
  ApiCall,
  ApiRouter,
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
 * Every HTTP decision the server does not make itself (core/transport). The server only reads
 * sockets and writes what this policy answers.
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
