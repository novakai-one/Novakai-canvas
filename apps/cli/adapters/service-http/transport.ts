import { responseEnvelope } from '@novakai/canvas-service';
import type { TransportResponse } from '@novakai/canvas-service';
import type { Transport } from '../../contract/ports/runtime.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
/** Credentials can only be sent to the declared IPv4 loopback origin, never a redirect or user-provided remote host. */
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
/** No redirected request receives the bearer token; timeout/connection failure remains uncertain until receipt reconciliation. */
async function send(
  origin: string,
  token: string,
  path: string,
  method: string,
  body: string | undefined,
): Promise<Result<TransportResponse, LocalFailure>> {
  try {
    const response = await fetch(`${origin}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(35000),
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
/** The token comes from protected local storage. It is never returned in command output or diagnostic details. */
export function createTransport(
  url: string,
  token: string,
): Result<Transport> {
  const checked = origin(url);
  if (!checked.ok) return checked;
  return success({
    get: (path) => send(checked.value, token, path, 'GET', undefined),
    post: (path, body) => send(checked.value, token, path, 'POST', JSON.stringify(body)),
  });
}
