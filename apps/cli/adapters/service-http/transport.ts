/*
 * HTTP transport to the local service: one checked loopback origin, a bearer token, and the
 * service's response envelope. Network I/O; each failure is returned as a value. A lost answer is
 * `connection-uncertain`; for a write, `core/authoring/submit.ts` names the retained request so
 * `receipt` then `retry` recover it. This file never retries.
 */
import { responseEnvelope } from '@novakai/canvas-service';
import type { ServiceAnswer, Transport } from '../../contract/ports/runtime.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import {
  generation,
  loopbackOrigin,
  type AgentToken,
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
): Result<Transport, LocalFailure> {
  const checked = origin(server);
  if (!checked.ok) return checked;
  return success({
    get: (path) => send(checked.value, token, path, 'GET', undefined),
    post: (path, body) => send(checked.value, token, path, 'POST', JSON.stringify(body)),
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
/**
 * Sends one request; a redirect is refused so no other host receives the token. Fails with
 * `invalid-response` (the answer is not a service envelope) or `connection-uncertain` (no
 * confirmed answer: timeout, lost connection or unreadable body).
 */
async function send(
  origin: LoopbackOrigin,
  token: AgentToken,
  path: string,
  method: Method,
  body: string | undefined,
): Promise<Result<ServiceAnswer, LocalFailure>> {
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
 * The service envelope's generation, minted, and its outcome, kept whole. Fails with
 * `invalid-response` when the body is not a service envelope.
 */
function answer(input: unknown): Result<ServiceAnswer, LocalFailure> {
  const envelope = responseEnvelope.safeParse(input);
  if (!envelope.success) return invalidEnvelope();
  const sent = generation.safeParse(envelope.data.generation);
  if (!sent.success) return invalidEnvelope();
  return success({ generation: sent.data, outcome: envelope.data.outcome });
}
/** The answer is not a service envelope. */
function invalidEnvelope(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: 'Service returned an invalid transport envelope',
  });
}
