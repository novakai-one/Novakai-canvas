/*
 * HTTP transport to the local service: one checked loopback origin, a bearer token, and the
 * service's response envelope. Network I/O; each failure is returned as a value. A lost answer is
 * `connection-uncertain`; for a write, `core/authoring/submit.ts` names the retained request so
 * `receipt` then `retry` recover it. This file never retries.
 */
import { responseEnvelope } from '@novakai/canvas-service';
import type { TransportResponse } from '@novakai/canvas-service';
import type { Transport } from '../../contract/ports/runtime.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** How long one request waits for the service's answer. */
const answerTimeoutMs = 35_000;

/** The HTTP methods the service routes accept. */
type Method = 'GET' | 'POST';

/**
 * Binds the transport to `url`, which must be an `http://127.0.0.1` origin. The token comes from
 * protected local storage and never appears in command output or failure details.
 * Fails with `invalid-server`.
 */
export function createTransport(
  url: string,
  token: string,
): Result<Transport, LocalFailure> {
  const checked = origin(url);
  if (!checked.ok) return checked;
  return success({
    get: (path) => send(checked.value, token, path, 'GET', undefined),
    post: (path, body) => send(checked.value, token, path, 'POST', JSON.stringify(body)),
  });
}
/**
 * The origin of `input`. Credentials go only to the IPv4 loopback origin, never to a redirect or a
 * remote host. Fails with `invalid-server`.
 */
function origin(input: string): Result<string, LocalFailure> {
  try {
    const url = new URL(input);
    if (!localOrigin(url))
      return failure({
        code: 'invalid-server',
        message: 'Server must be an IPv4 loopback HTTP origin',
      });
    return success(url.origin);
  } catch {
    return failure({ code: 'invalid-server', message: 'Server URL is invalid' });
  }
}
/** Origin-only loopback addressing excludes URL credentials, alternate paths and redirect destinations. */
function localOrigin(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}
/**
 * Sends one request; a redirect is refused so no other host receives the token. Fails with
 * `invalid-response` (the answer is not a service envelope) or `connection-uncertain` (no
 * confirmed answer: timeout, lost connection or unreadable body).
 */
async function send(
  origin: string,
  token: string,
  path: string,
  method: Method,
  body: string | undefined,
): Promise<Result<TransportResponse, LocalFailure>> {
  try {
    const response = await fetch(`${origin}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(answerTimeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ?? null,
    });
    const input: unknown = await response.json();
    const checked = responseEnvelope.safeParse(input);
    if (!checked.success)
      return failure({
        code: 'invalid-response',
        message: 'Service returned an invalid transport envelope',
      });
    return success(checked.data);
  } catch {
    return failure({
      code: 'connection-uncertain',
      message: 'Service response could not be confirmed',
      recovery: 'Retain the request and reconcile its receipt before retrying.',
    });
  }
}
