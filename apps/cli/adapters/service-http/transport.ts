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
import type { HttpTransport, RouteQuery } from '../../contract/ports/http-transport.js';
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
    get: (route, query) => send(server, token, route + search(query), 'GET', undefined),
    post: (route, body) => send(server, token, route, 'POST', JSON.stringify(body)),
  };
}
/** A read route's query string: `?` and the parameters in order, or nothing when there are none. */
function search(query: RouteQuery | undefined): string {
  if (query === undefined) return '';
  return `?${new URLSearchParams(query).toString()}`;
}
/**
 * Sends one request; a redirect is refused so no other host receives the token. Fails with
 * `invalid-response` (the answer is not a service envelope), `connection-uncertain` (no confirmed
 * answer: timeout, lost connection or unreadable body) or `service-rejected`.
 */
async function send(
  origin: LoopbackOrigin,
  token: AgentToken,
  path: string,
  method: Method,
  body: string | undefined,
): Promise<Result<ServiceAnswer<unknown>>> {
  try {
    const response = await fetch(`${origin}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(answerTimeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ?? null,
    });
    return answer(await response.json());
  } catch {
    return failure({
      code: 'connection-uncertain',
      message: 'Service response could not be confirmed',
      recovery: 'Retain the request and reconcile its receipt before retrying.',
    });
  }
}
/**
 * The service envelope's generation, minted, and its value. Fails with `invalid-response` when the
 * body is not a service envelope, or `service-rejected` with the service's failure record.
 */
function answer(input: unknown): Result<ServiceAnswer<unknown>> {
  const envelope = responseEnvelope.safeParse(input);
  if (!envelope.success) return invalidEnvelope();
  const sent = serviceGeneration.safeParse(envelope.data.generation);
  if (!sent.success) return invalidEnvelope();
  return observed(sent.data, envelope.data.outcome);
}
/** A successful outcome's value under its generation; a failed one as `service-rejected`, kept whole. */
function observed(
  sent: ServiceGeneration,
  outcome: TransportResponse['outcome'],
): Result<ServiceAnswer<unknown>> {
  if (!outcome.ok) return foreignFailure('service-rejected', outcome.error);
  return success({ generation: sent, value: outcome.value });
}
/** The answer is not a service envelope. */
function invalidEnvelope(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'Service returned an invalid transport envelope',
  });
}
