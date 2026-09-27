/*
 * HTTP transport to the local service: one checked loopback origin, a bearer token, and the
 * service's response envelope; a rejection in it becomes `service-rejected`. Network I/O; each
 * failure is returned as a value. A lost answer is `connection-uncertain`; for a write,
 * `core/authoring/submit.ts` names the retained request so `receipt` then `retry` recover it.
 * This file never retries.
 */
import { responseEnvelope } from '@novakai/canvas-service';
import type { HttpTransport, RouteQuery } from '../../contract/ports/http-transport.js';
import type { Observed } from '../../contract/records/service-answers.js';
import type { TransportResponse } from '../../contract/records/foreign.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, rejected, success } from '../../contract/errors.js';
import {
  generation,
  loopbackOrigin,
  type AgentToken,
  type Generation,
  type LoopbackOrigin,
} from '../../contract/brands.js';

/** How long one request waits for the service's answer. */
const answerTimeoutMs = 35_000;

/** The HTTP methods the service routes accept. */
type Method = 'GET' | 'POST';

/**
 * Binds the transport to `server`, which must be an `http://127.0.0.1` origin. The token comes
 * from protected local storage and never appears in command output or failure details.
 * Fails with `invalid-server`.
 */
export function createTransport(
  server: string,
  token: AgentToken,
): Result<HttpTransport, LocalFailure> {
  const checked = origin(server);
  if (!checked.ok) return checked;
  return success({
    get: (route, query) => send(checked.value, token, route + search(query), 'GET', undefined),
    post: (route, body) => send(checked.value, token, route, 'POST', JSON.stringify(body)),
  });
}
/**
 * Mints the origin credentials may go to: the IPv4 loopback origin, never a redirect or a remote
 * host. Fails with `invalid-server`: text that is not a URL first, then a URL that is not a
 * loopback origin.
 */
function origin(input: string): Result<LoopbackOrigin, LocalFailure> {
  if (!URL.canParse(input))
    return failure({ code: 'invalid-server', message: 'Server URL is invalid' });
  const checked = loopbackOrigin.safeParse(input);
  if (!checked.success)
    return failure({
      code: 'invalid-server',
      message: 'Server must be an IPv4 loopback HTTP origin',
    });
  return success(checked.data);
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
): Promise<Result<Observed<unknown>>> {
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
function answer(input: unknown): Result<Observed<unknown>> {
  const envelope = responseEnvelope.safeParse(input);
  if (!envelope.success) return invalidEnvelope();
  const sent = generation.safeParse(envelope.data.generation);
  if (!sent.success) return invalidEnvelope();
  return observed(sent.data, envelope.data.outcome);
}
/** A successful outcome's value under its generation; a failed one as `service-rejected`, kept whole. */
function observed(
  sent: Generation,
  outcome: TransportResponse['outcome'],
): Result<Observed<unknown>> {
  if (!outcome.ok) return rejected('service-rejected', outcome.error);
  return success({ generation: sent, value: outcome.value });
}
/** The answer is not a service envelope. */
function invalidEnvelope(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'Service returned an invalid transport envelope',
  });
}
