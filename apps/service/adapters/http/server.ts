/*
 * The node:http edge of the service. Impure (sockets, timers). `TransportPolicy` decides the
 * request head, body, kind, query, status, envelope, browser access and event frames. Kept here:
 * loopback listen and close, socket limits, heartbeat, request order, the contract's fixed header
 * tables, the JSON content type, the `Content-Disposition` format and status 200 for bytes and
 * events. A failed start leaves the workspace with the caller. A request that throws answers
 * `unavailable`, and its client reconciles the request's receipt.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ServerBindings } from '../../contract/ports/transport.js';
import type { Caller, HttpMetadata } from '../../contract/records/transport/http.js';
import { loopbackIp } from '../../contract/records/transport/http.js';
import type { RouteOutcome, WireOutcome } from '../../contract/records/transport/protocol.js';
import type {
  LocalServer,
  RequestKind,
  ServerOptions,
  StaticFile,
} from '../../contract/records/transport/server.js';
import { eventStreamHeaders, isolationHeaders } from '../../contract/records/transport/server.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** Socket limits: the largest request head (bytes); how long a request and its head may take (ms). */
const SOCKET_LIMITS = Object.freeze({
  maxHeaderSize: 16384,
  requestTimeout: 35000,
  headersTimeout: 10000,
});
/** How often an idle change stream sends a keepalive frame (ms). */
const HEARTBEAT_MS = 15000;
/** The answer when the server does not close cleanly. */
const CLOSE_FAILED = failure<never>('unavailable', 'server', 'HTTP server could not close cleanly');
/** The answer when a request throws before it is answered. */
const INCOMPLETE = failure<never>(
  'unavailable',
  'request',
  'Request did not complete; reconcile its receipt before retrying',
);

/** One request in flight: the native objects, its cancellation, head and URL, and the bindings. */
interface Exchange {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly signal: AbortSignal;
  readonly metadata: HttpMetadata;
  readonly url: URL;
  readonly bindings: ServerBindings;
}
/** Answers one request of a kind. */
type Handler = (exchange: Exchange) => Promise<void>;
/** Answers one authenticated request. */
type CallerHandler = (exchange: Exchange, caller: Caller) => Promise<void> | void;

/** The handler of each request kind; the change stream and the API authenticate first. */
const HANDLERS: Readonly<Record<RequestKind, Handler>> = Object.freeze({
  events: (exchange) => authenticated(exchange, streamEvents),
  api: (exchange) => authenticated(exchange, invokeApi),
  browser: serveBrowser,
});

/**
 * Listens on IPv4 loopback at `options.port`. Fails with `unavailable` at `server` when the port
 * cannot be opened. The workspace stays with the caller, which closes it.
 */
export function startHttpServer(
  options: ServerOptions,
  bindings: ServerBindings,
): Promise<Result<LocalServer>> {
  return new Promise((resolve) => {
    const server = createServer(SOCKET_LIMITS, (request, response) =>
      receive(request, response, bindings),
    );
    server.once('error', () =>
      resolve(failure('unavailable', 'server', 'Configured loopback port could not be opened')),
    );
    server.listen(options.port, loopbackIp, () =>
      resolve(
        success({
          url: bindings.security.address.origin,
          generation: bindings.security.generation,
          close: () => close(server),
        }),
      ),
    );
  });
}

/**
 * Stops listening and drops open sockets, which cancels their requests. Fails with `unavailable`
 * at `server` when the server does not close cleanly; the caller then closes the workspace.
 */
function close(server: Server): Promise<Result<void>> {
  return new Promise((resolve) => {
    server.close((error) => resolve(error ? CLOSE_FAILED : success(undefined)));
    server.closeAllConnections();
  });
}

/**
 * Answers one request. A closed socket aborts its work (a render stops its worker). Any throw,
 * a malformed URL included, answers `INCOMPLETE` (`unavailable` at `request`).
 */
function receive(
  request: IncomingMessage,
  response: ServerResponse,
  bindings: ServerBindings,
): void {
  const controller = new AbortController();
  response.once('close', () => controller.abort());
  void route(request, response, controller.signal, bindings).catch(() =>
    writeJson(response, INCOMPLETE, bindings),
  );
}

/** Reads the head and URL, then runs the handler of the request's kind. */
async function route(
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  bindings: ServerBindings,
): Promise<void> {
  const metadata = bindings.policy.head(request.method, request.headersDistinct);
  const url = new URL(request.url ?? '/', bindings.security.address.origin);
  const exchange: Exchange = { request, response, signal, metadata, url, bindings };
  await HANDLERS[bindings.policy.kind(metadata.method, url.pathname)](exchange);
}

/** Runs `handler` for an authenticated caller; a refused caller gets admission's failure. */
async function authenticated(
  exchange: Exchange,
  handler: CallerHandler,
): Promise<void> {
  const caller = exchange.bindings.admission.authenticate(exchange.metadata);
  if (!caller.ok) return writeJson(exchange.response, caller, exchange.bindings);
  await handler(exchange, caller.value);
}

/** Streams the policy's event frames until the client disconnects. */
function streamEvents({ response, bindings }: Exchange): void {
  const { frames } = bindings.policy;
  const { generation } = bindings.security;
  response.writeHead(200, eventStreamHeaders);
  response.write(frames.connected(generation));
  const unsubscribe = bindings.changes.subscribe((change) =>
    response.write(frames.committed(generation, change)),
  );
  const heartbeat = setInterval(() => response.write(frames.keepalive), HEARTBEAT_MS);
  response.once('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/** Reads the body only after authentication, then writes the router's outcome. */
async function invokeApi(
  exchange: Exchange,
  caller: Caller,
): Promise<void> {
  const { request, response, url, bindings } = exchange;
  const body = await bindings.policy.body(request.iterator({ destroyOnReturn: false }));
  if (!body.ok) return writeJson(response, body, bindings);
  const outcome = await bindings.router.invoke({
    path: url.pathname,
    query: bindings.policy.query(url.searchParams),
    caller,
    signal: exchange.signal,
    metadata: exchange.metadata,
    body: body.value,
  });
  if (isFile(outcome)) return writeBytes(response, outcome.file);
  writeJson(response, outcome, bindings);
}

/** Whether the route answered with a file to send as bytes. */
function isFile(outcome: RouteOutcome): outcome is Extract<RouteOutcome, { kind: 'bytes' }> {
  return 'kind' in outcome && outcome.kind === 'bytes';
}

/** Serves the web app once the policy grants browser access; sets the cookie a navigation gets. */
async function serveBrowser(exchange: Exchange): Promise<void> {
  const { response, metadata, bindings } = exchange;
  const access = bindings.policy.browserAccess(metadata);
  if (!access.ok) return writeJson(response, access, bindings);
  if (access.value.kind === 'session-issued')
    response.setHeader('Set-Cookie', access.value.setCookie);
  return serveFile(exchange);
}

/** Writes the built file at the URL path, or the static files' failure. */
async function serveFile({ response, url, bindings }: Exchange): Promise<void> {
  const file = await bindings.files.read(url.pathname);
  if (!file.ok) return writeJson(response, file, bindings);
  writeBytes(response, file.value);
}

/** Writes the policy's status and envelope; nothing when the socket is already gone. */
function writeJson(
  response: ServerResponse,
  outcome: WireOutcome,
  bindings: ServerBindings,
): void {
  if (response.destroyed) return;
  setHeaders(response, isolationHeaders);
  response.statusCode = bindings.policy.status(outcome);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(bindings.policy.envelope(outcome, bindings.security.generation)));
}

/** Writes a file's bytes with its media type, download name and extra headers. */
function writeBytes(
  response: ServerResponse,
  file: StaticFile,
): void {
  setHeaders(response, isolationHeaders);
  response.statusCode = 200;
  response.setHeader('Content-Type', file.mediaType);
  if (file.filename !== undefined)
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  setHeaders(response, file.headers ?? {});
  response.end(file.bytes);
}

/** Sets each header, in order. */
function setHeaders(
  response: ServerResponse,
  headers: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}
