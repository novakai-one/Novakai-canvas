import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { HttpMetadata } from '../../contract/records/http.js';
import type { Caller } from '../../contract/records/http.js';
import type { LocalServer, ServerBindings, ServerOptions } from '../../contract/records/server.js';
import type { RouteOutcome } from '../../contract/records/protocol.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

interface Exchange {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly signal: AbortSignal;
  readonly metadata: HttpMetadata;
  readonly url: URL;
}
/** Committed messages are hints. Every connection first receives the host generation and rereads authoritative state. */
function events(
  exchange: Exchange,
  bindings: ServerBindings,
): void {
  const response = exchange.response;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.write(
    `event: connected\ndata: ${JSON.stringify({ version: 1, generation: bindings.security.generation })}\n\n`,
  );
  const unsubscribe = bindings.changes.subscribe((change) => {
    response.write(
      `event: committed\ndata: ${JSON.stringify({ version: 1, generation: bindings.security.generation, change })}\n\n`,
    );
  });
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
  response.once('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
/** Authentication precedes streaming reads and route lookup. Unsupported API methods cannot bootstrap a browser session. */
async function api(
  exchange: Exchange,
  bindings: ServerBindings,
): Promise<void> {
  const caller = bindings.admission.authenticate(exchange.metadata);
  if (!caller.ok) {
    bindings.io.json(exchange.response, caller, bindings.security.generation);
    return;
  }
  return authenticatedApi(exchange, caller.value, bindings);
}
/** Streaming and ordinary API requests share the same authentication boundary. */
async function authenticatedApi(
  exchange: Exchange,
  caller: Caller,
  bindings: ServerBindings,
): Promise<void> {
  if (`${exchange.metadata.method} ${exchange.url.pathname}` === 'GET /api/v1/events') {
    events(exchange, bindings);
    return;
  }
  return invokeApi(exchange, caller, bindings);
}
/** Body decoding occurs only for an admitted caller; route failures retain the generation in their response. */
async function invokeApi(
  exchange: Exchange,
  caller: Caller,
  bindings: ServerBindings,
): Promise<void> {
  const body = await bindings.io.body(exchange.request);
  if (!body.ok) {
    bindings.io.json(exchange.response, body, bindings.security.generation);
    return;
  }
  const outcome = await bindings.router.invoke({
    path: exchange.url.pathname,
    query: queryValues(exchange.url.searchParams, exchange.url.pathname === '/api/v1/source'),
    caller,
    signal: exchange.signal,
    metadata: exchange.metadata,
    body: body.value,
  });
  if (isBytes(outcome)) {
    bindings.io.bytes(exchange.response, outcome.file);
    return;
  }
  bindings.io.json(exchange.response, outcome, bindings.security.generation);
}

function isBytes(outcome: RouteOutcome): outcome is Extract<RouteOutcome, { kind: 'bytes' }> {
  return 'kind' in outcome && outcome.kind === 'bytes';
}

function queryValues(
  params: URLSearchParams,
  preserveScopeDuplicates: boolean,
): Readonly<Record<string, string>> {
  if (!preserveScopeDuplicates) return Object.fromEntries(params);
  const values = new Map<string, string>();
  for (const [key, value] of params) appendQueryValue(values, key, value);
  return Object.fromEntries(values);
}

function appendQueryValue(
  values: Map<string, string>,
  key: string,
  value: string,
): void {
  if (key !== 'section' && key !== 'object') {
    values.set(key, value);
    return;
  }
  values.set(key, joinedScopeValue(values.get(key), value));
}

function joinedScopeValue(
  previous: string | undefined,
  value: string,
): string {
  return previous === undefined ? value : `${previous}\u0000${value}`;
}
/** A navigation grants only an HttpOnly browser session. Subsequent resource reads still pass exact host/origin admission. */
function browserAccess(
  exchange: Exchange,
  bindings: ServerBindings,
): Result<void> {
  if (exchange.metadata.mode !== 'navigate') {
    return existingBrowserAccess(exchange, bindings);
  }
  return establishBrowserAccess(exchange, bindings);
}
/** Resource fetches can only reuse an already established session. */
function existingBrowserAccess(
  exchange: Exchange,
  bindings: ServerBindings,
): Result<void> {
  const caller = bindings.admission.authenticate(exchange.metadata);
  if (!caller.ok) return caller;
  return { ok: true, value: undefined };
}
/** Only the navigation branch can issue the session cookie. */
function establishBrowserAccess(
  exchange: Exchange,
  bindings: ServerBindings,
): Result<void> {
  const navigation = bindings.admission.bootstrap(exchange.metadata);
  if (!navigation.ok) return navigation;
  exchange.response.setHeader(
    'Set-Cookie',
    `${bindings.admission.cookieName}=${bindings.security.browserSession}; HttpOnly; SameSite=Strict; Path=/`,
  );
  return { ok: true, value: undefined };
}
/** Built application requests cannot invoke handlers and never read outside the configured static root. */
async function browser(
  exchange: Exchange,
  bindings: ServerBindings,
): Promise<void> {
  const access = browserAccess(exchange, bindings);
  if (!access.ok) {
    bindings.io.json(exchange.response, access, bindings.security.generation);
    return;
  }
  const file = await bindings.files.read(exchange.url.pathname);
  if (!file.ok) {
    bindings.io.json(exchange.response, file, bindings.security.generation);
    return;
  }
  bindings.io.bytes(exchange.response, file.value);
}
/** URL construction failures and provider throws stop at the HTTP boundary; clients retain requests for receipt recovery. */
async function route(
  exchange: Exchange,
  bindings: ServerBindings,
): Promise<void> {
  if (exchange.url.pathname.startsWith('/api/')) return api(exchange, bindings);
  return browser(exchange, bindings);
}
/** Each request owns cancellation; a disconnected render terminates its worker, while committed receipts remain queryable. */
function receive(
  request: IncomingMessage,
  response: ServerResponse,
  bindings: ServerBindings,
): void {
  const controller = new AbortController();
  response.once('close', () => controller.abort());
  void receiveRoute(request, response, controller.signal, bindings).catch(() =>
    bindings.io.json(
      response,
      failure(
        'unavailable',
        'request',
        'Request did not complete; reconcile its receipt before retrying',
      ),
      bindings.security.generation,
    ),
  );
}
/** URL parsing also runs inside the asynchronous failure boundary; malformed input cannot escape the native callback. */
async function receiveRoute(
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  bindings: ServerBindings,
): Promise<void> {
  const exchange = {
    request,
    response,
    signal,
    metadata: bindings.io.metadata(request),
    url: new URL(request.url ?? '/', bindings.security.origin),
  };
  await route(exchange, bindings);
}
/** Closing aborts active sockets, which cancels request workers; the composition caller then drains and closes the workspace. */
function close(server: Server): Promise<Result<void>> {
  return new Promise((resolve) => {
    server.close((error) => {
      if (error) {
        resolve(failure('unavailable', 'server', 'HTTP server could not close cleanly'));
        return;
      }
      resolve({ ok: true, value: undefined });
    });
    server.closeAllConnections();
  });
}
/** Bind only IPv4 loopback. Startup failure leaves workspace ownership with the caller for explicit cleanup. */
export function startHttpServer(
  options: ServerOptions,
  bindings: ServerBindings,
): Promise<Result<LocalServer>> {
  return new Promise((resolve) => {
    const server = createServer(
      { maxHeaderSize: 16384, requestTimeout: 35000, headersTimeout: 10000 },
      (request, response) => receive(request, response, bindings),
    );
    server.once('error', () =>
      resolve(failure('unavailable', 'server', 'Configured loopback port could not be opened')),
    );
    server.listen(options.port, '127.0.0.1', () =>
      resolve({
        ok: true,
        value: {
          url: bindings.security.origin,
          generation: bindings.security.generation,
          close: () => close(server),
        },
      }),
    );
  });
}
