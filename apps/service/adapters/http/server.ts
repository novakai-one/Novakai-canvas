/*
 * Why this file exists
 *
 * The browser and the CLI reach the service over HTTP at 127.0.0.1. Something has to own the
 * socket: listen, read each request, and write each answer. For example, `GET /api/v1/identity`
 * with the CLI's token is let in, sent to the API router, and answered as JSON.
 *
 * This file is that socket code. It keeps only the plumbing: limits, timers, request order and
 * fixed headers. Every decision, like who may come in or which status to send, comes from
 * `TransportPolicy` (core/transport). A request that throws answers `unavailable`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ServerBindings } from '../../contract/ports/transport.js';
import type { Caller, HttpMetadata } from '../../contract/records/transport/http.js';
import { loopbackIp } from '../../contract/records/transport/http.js';
import type { ApiCall, RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { HttpOutcome } from '../../contract/records/transport/http-codes.js';
import type {
  LocalServer,
  RequestKind,
  ServerOptions,
  SentFile,
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
/** The HTTP status of a stream or a file that is sent. */
const OK_STATUS = 200;
/** The media type of every JSON answer. */
const JSON_MEDIA_TYPE = 'application/json; charset=utf-8';
/** The extra headers of a file that brings none. */
const NO_HEADERS: Readonly<Record<string, string>> = Object.freeze({});

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
type AnswerRequest = (exchange: Exchange) => Promise<void>;
/** Answers one request once its caller is known. */
type AnswerCaller = (exchange: Exchange, caller: Caller) => Promise<void> | void;

/** How each kind of request is answered; the change stream and the API check the caller first. */
const ANSWER_BY_KIND: Readonly<Record<RequestKind, AnswerRequest>> = Object.freeze({
  events: (exchange) => answerKnownCaller(exchange, streamEvents),
  api: (exchange) => answerKnownCaller(exchange, invokeApi),
  browser: serveBrowser,
});

/**
 * Starts the HTTP server on 127.0.0.1 at `options.port`, answering each request with `bindings`.
 * Fails with `unavailable` at `server` when the port can't be opened. The running server's `close`
 * fails the same way if it can't close cleanly. It never opens or closes the workspace; whoever
 * opened it closes it.
 */
export function startHttpServer(
  options: ServerOptions,
  bindings: ServerBindings,
): Promise<Result<LocalServer>> {
  return new Promise((resolve) => {
    const server = createServer(SOCKET_LIMITS, (request, response) =>
      answerRequest(request, response, bindings),
    );
    server.once('error', () => resolve(portUnavailableFailure()));
    server.listen(options.port, loopbackIp, () => resolve(describeRunningServer(server, bindings)));
  });
}

/** Describes the running server: its address, this start's label, and how to close it. */
function describeRunningServer(
  server: Server,
  bindings: ServerBindings,
): Result<LocalServer> {
  const localServer: LocalServer = {
    url: bindings.security.address.origin,
    generation: bindings.security.generation,
    close: () => closeServer(server),
  };
  return success(localServer);
}

/** Stops listening and drops every open connection, which cancels their requests. */
function closeServer(server: Server): Promise<Result<void>> {
  return new Promise((resolve) => {
    server.close((closeError) => resolve(checkCleanClose(closeError)));
    server.closeAllConnections();
  });
}

/** Checks the server closed cleanly; the caller then closes the workspace either way. */
function checkCleanClose(closeError: Error | undefined): Result<void> {
  if (closeError) {
    return serverCloseFailure();
  }
  return success(undefined);
}

/**
 * Answers one request. A closed socket cancels its work (a render stops its worker). A request
 * that throws, a malformed URL included, answers the incomplete-request mistake.
 */
function answerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bindings: ServerBindings,
): void {
  const cancellation = new AbortController();
  response.once('close', () => cancellation.abort());
  const routed = routeRequest(request, response, cancellation.signal, bindings);
  void routed.catch(() => writeJson(response, incompleteRequestFailure(), bindings));
}

/** Reads the request's head and URL, then answers it the way its kind is answered. */
async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  bindings: ServerBindings,
): Promise<void> {
  const metadata = bindings.policy.head(request.method, request.headersDistinct);
  const requestPath = request.url ?? '/';
  const url = new URL(requestPath, bindings.security.address.origin);
  const exchange: Exchange = { request, response, signal, metadata, url, bindings };
  const kind = bindings.policy.kind(metadata.method, url.pathname);
  const answerKind = ANSWER_BY_KIND[kind];
  await answerKind(exchange);
}

/** Runs `answerCaller` once admission knows the caller; otherwise writes admission's mistake. */
async function answerKnownCaller(
  exchange: Exchange,
  answerCaller: AnswerCaller,
): Promise<void> {
  const caller = exchange.bindings.admission.authenticate(exchange.metadata);
  if (!caller.ok) {
    writeJson(exchange.response, caller, exchange.bindings);
    return;
  }
  await answerCaller(exchange, caller.value);
}

/** Streams each saved change to the caller, with a keepalive frame when idle, until they leave. */
function streamEvents({ response, bindings }: Exchange): void {
  const { frames } = bindings.policy;
  const { generation } = bindings.security;
  response.writeHead(OK_STATUS, eventStreamHeaders);
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

/** Reads the body (only now that the caller is known), asks the API router, and writes its answer. */
async function invokeApi(
  exchange: Exchange,
  caller: Caller,
): Promise<void> {
  const { request, response, url, bindings } = exchange;
  const body = await bindings.policy.body(request.iterator({ destroyOnReturn: false }));
  if (!body.ok) {
    writeJson(response, body, bindings);
    return;
  }
  const apiCall: ApiCall = {
    path: url.pathname,
    query: bindings.policy.query(url.searchParams),
    caller,
    signal: exchange.signal,
    metadata: exchange.metadata,
    body: body.value,
  };
  const routed = await bindings.router.invoke(apiCall);
  writeRouteOutcome(response, routed, bindings);
}

/** Writes a route's answer: a file as bytes, anything else as JSON. */
function writeRouteOutcome(
  response: ServerResponse,
  routed: RouteOutcome,
  bindings: ServerBindings,
): void {
  if (routed.kind === 'bytes') {
    writeBytes(response, routed.file);
    return;
  }
  writeJson(response, routed.outcome, bindings);
}

/** Serves the web app once the policy lets the browser in; sets the cookie when it issues one. */
async function serveBrowser(exchange: Exchange): Promise<void> {
  const { response, metadata, bindings } = exchange;
  const access = bindings.policy.browserAccess(metadata);
  if (!access.ok) {
    writeJson(response, access, bindings);
    return;
  }
  if (access.value.kind === 'session-issued') {
    response.setHeader('Set-Cookie', access.value.setCookie);
  }
  await serveFile(exchange);
}

/** Writes the built file the URL path names, or the static files' mistake. */
async function serveFile({ response, url, bindings }: Exchange): Promise<void> {
  const file = await bindings.files.read(url.pathname);
  if (!file.ok) {
    writeJson(response, file, bindings);
    return;
  }
  writeBytes(response, file.value);
}

/** Writes the outcome as JSON with the policy's status; does nothing once the socket is gone. */
function writeJson(
  response: ServerResponse,
  outcome: HttpOutcome,
  bindings: ServerBindings,
): void {
  if (response.destroyed) {
    return;
  }
  setHeaders(response, isolationHeaders);
  response.statusCode = bindings.policy.status(outcome);
  response.setHeader('Content-Type', JSON_MEDIA_TYPE);
  const envelope = bindings.policy.envelope(outcome, bindings.security.generation);
  response.end(JSON.stringify(envelope));
}

/** Writes a file's bytes with its media type, its download name and its extra headers. */
function writeBytes(
  response: ServerResponse,
  file: SentFile,
): void {
  setHeaders(response, isolationHeaders);
  response.statusCode = OK_STATUS;
  response.setHeader('Content-Type', file.mediaType);
  setDownloadName(response, file.filename);
  setHeaders(response, file.headers ?? NO_HEADERS);
  response.end(file.bytes);
}

/** Tells the browser to save the file under `filename`, when the file has one. */
function setDownloadName(
  response: ServerResponse,
  filename: string | undefined,
): void {
  if (filename === undefined) {
    return;
  }
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

/** Sets each header, in order. */
function setHeaders(
  response: ServerResponse,
  headers: Readonly<Record<string, string>>,
): void {
  for (const [name, headerText] of Object.entries(headers)) {
    response.setHeader(name, headerText);
  }
}

/** Makes the mistake for a port that can't be opened. */
function portUnavailableFailure(): Result<never> {
  return failure('unavailable', 'server', 'Configured loopback port could not be opened');
}

/** Makes the mistake for a server that doesn't close cleanly. */
function serverCloseFailure(): Result<never> {
  return failure('unavailable', 'server', 'HTTP server could not close cleanly');
}

/** Makes the mistake for a request that threw before it was answered. */
function incompleteRequestFailure(): Result<never> {
  return failure(
    'unavailable',
    'request',
    'Request did not complete; reconcile its receipt before retrying',
  );
}
