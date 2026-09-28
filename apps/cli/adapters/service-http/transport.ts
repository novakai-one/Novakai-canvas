/*
 * Why this file exists
 *
 * Every service command is one HTTP call to the local service, carrying the agent's token. The
 * answer comes wrapped in the service's envelope, `{ generation, outcome }`. The agent must tell
 * apart three ways a call goes wrong: no sure answer, an answer that isn't the service's, or a no.
 *
 * This file makes that call and unwraps the envelope. It sends only to the checked `--server`
 * address, never follows a redirect, never retries, and never shows the token.
 */
import { responseEnvelope } from '@novakai/canvas-service';
import type {
  HttpTransport,
  ReadRoute,
  RouteQuery,
  WriteRoute,
} from '../../contract/ports/http-transport.js';
import type { ServiceAnswer } from '../../contract/records/service-answers.js';
import type { TransportResponse } from '../../contract/records/foreign.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, foreignFailure, success } from '../../contract/errors.js';
import {
  serviceGeneration,
  type AgentToken,
  type ServiceGeneration,
  type LoopbackOrigin,
} from '../../contract/brands.js';

/** How long one request waits for the service's answer. */
const answerTimeoutMs = 35_000;

/** The HTTP methods the service routes accept. */
type Method = 'GET' | 'POST';

/** One request to send: its method, its path with any query string, and any JSON body. */
interface OutgoingRequest {
  readonly method: Method;
  readonly path: string;
  readonly body: string | undefined;
}

/**
 * Gives core its HTTP calls to `server` (`http://127.0.0.1`, checked from `--server`), each sent
 * with `token`. A call fails with `connection-uncertain` (no sure answer within 35 seconds),
 * `invalid-response` (the answer isn't the service's) or `service-rejected` (the service said no).
 */
export function createHttpTransport(
  server: LoopbackOrigin,
  token: AgentToken,
): HttpTransport {
  return {
    get: (route, query) => send(server, token, getRequest(route, query)),
    post: (route, body) => send(server, token, postRequest(route, body)),
  };
}

/** Makes a GET request to the route, with the query string when there is one. */
function getRequest(
  route: ReadRoute,
  query: RouteQuery | undefined,
): OutgoingRequest {
  const path = route + queryString(query);
  return { method: 'GET', path, body: undefined };
}

/** Makes a POST request to the route, with the body as JSON text. */
function postRequest(
  route: WriteRoute,
  body: unknown,
): OutgoingRequest {
  const jsonBody = JSON.stringify(body);
  return { method: 'POST', path: route, body: jsonBody };
}

/** Makes the query string: `?` and the parameters in order, or nothing when there are none. */
function queryString(query: RouteQuery | undefined): string {
  if (query === undefined) {
    return '';
  }
  const parameters = new URLSearchParams(query);
  return `?${parameters.toString()}`;
}

/** Sends one request to the service, then unwraps the envelope its answer comes in. */
async function send(
  origin: LoopbackOrigin,
  token: AgentToken,
  outgoing: OutgoingRequest,
): Promise<Result<ServiceAnswer<unknown>>> {
  const answerBody = await fetchAnswerBody(origin, token, outgoing);
  if (!answerBody.ok) {
    return answerBody;
  }
  return unwrapEnvelope(answerBody.value);
}

/** Sends the request and reads the JSON answer. It refuses redirects, so the token stays here. */
async function fetchAnswerBody(
  origin: LoopbackOrigin,
  token: AgentToken,
  outgoing: OutgoingRequest,
): Promise<Result<unknown>> {
  try {
    const response = await fetch(`${origin}${outgoing.path}`, fetchOptions(token, outgoing));
    const answerBody: unknown = await response.json();
    return success(answerBody);
  } catch {
    return connectionUncertainFailure();
  }
}

/** Makes fetch's options: the method, no redirects, the 35-second wait, the token and the body. */
function fetchOptions(
  token: AgentToken,
  outgoing: OutgoingRequest,
): RequestInit {
  return {
    method: outgoing.method,
    redirect: 'error',
    signal: AbortSignal.timeout(answerTimeoutMs),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: outgoing.body ?? null,
  };
}

/** Checks the answer is a service envelope, then reads its generation and outcome. */
function unwrapEnvelope(answerBody: unknown): Result<ServiceAnswer<unknown>> {
  const envelope = responseEnvelope.safeParse(answerBody);
  if (!envelope.success) {
    return invalidEnvelopeFailure();
  }
  const generation = serviceGeneration.safeParse(envelope.data.generation);
  if (!generation.success) {
    return invalidEnvelopeFailure();
  }
  return unwrapOutcome(generation.data, envelope.data.outcome);
}

/** Gives a good outcome's value under its generation, or passes the service's no on whole. */
function unwrapOutcome(
  generation: ServiceGeneration,
  outcome: TransportResponse['outcome'],
): Result<ServiceAnswer<unknown>> {
  if (!outcome.ok) {
    return foreignFailure('service-rejected', outcome.error);
  }
  return success({ generation, value: outcome.value });
}

/** Makes the mistake for no sure answer: a timeout, a lost connection or an unreadable body. */
function connectionUncertainFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'connection-uncertain',
    message: 'Service response could not be confirmed',
    recovery: 'Retain the request and reconcile its receipt before retrying.',
  });
}

/** Makes the mistake for an answer that isn't a service envelope (`invalid-response`). */
function invalidEnvelopeFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'Service returned an invalid transport envelope',
  });
}
