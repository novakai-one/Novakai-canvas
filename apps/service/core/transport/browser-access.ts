/*
 * Access to the built web app: a direct navigation receives the HttpOnly browser session cookie;
 * any other request must already hold that session. Pure over the ingress policy
 * (core/transport/admission.ts) and the server's session secret. A refusal issues nothing; the
 * browser reloads the workspace from its loopback address.
 */
import type {
  HttpAdmission,
  HttpSecurity,
  TransportPolicy,
} from '../../contract/ports/transport.js';
import type { HttpMetadata } from '../../contract/records/transport/http.js';
import type { BrowserGrant } from '../../contract/records/transport/server.js';
import { success, type Result } from '../../contract/errors.js';

/** The ingress checks and the session secret browser access relies on. */
export interface BrowserAccessOwners {
  readonly admission: Pick<HttpAdmission, 'bootstrap' | 'authenticate' | 'cookieName'>;
  readonly security: Pick<HttpSecurity, 'browserSession'>;
}

/** The grant for a request that already holds the session. */
const SESSION_EXISTS: BrowserGrant = Object.freeze({ kind: 'session-exists' });

/**
 * Binds browser access to one server. A navigation (`Sec-Fetch-Mode: navigate`) is granted the
 * session cookie or fails with `unauthorized` at `host` or `navigation` (admission `bootstrap`).
 * Any other request is granted the existing session or fails with `unauthorized` at `host`,
 * `session` or `credential` (admission `authenticate`).
 */
export function createBrowserAccess(owners: BrowserAccessOwners): TransportPolicy['browserAccess'] {
  return (metadata) => browserAccess(metadata, owners);
}

/** A navigation as `issuedSession`; any other request as `existingSession`. */
function browserAccess(
  metadata: HttpMetadata,
  owners: BrowserAccessOwners,
): Result<BrowserGrant> {
  if (metadata.mode !== 'navigate') return existingSession(metadata, owners);
  return issuedSession(metadata, owners);
}

/**
 * A resource fetch reuses the established session only. Fails as admission `authenticate`:
 * `unauthorized` at `host`, `session` or `credential`.
 */
function existingSession(
  metadata: HttpMetadata,
  owners: BrowserAccessOwners,
): Result<BrowserGrant> {
  const caller = owners.admission.authenticate(metadata);
  if (!caller.ok) return caller;
  return success(SESSION_EXISTS);
}

/**
 * Only a navigation may receive the session cookie. Fails as admission `bootstrap`:
 * `unauthorized` at `host` or `navigation`.
 */
function issuedSession(
  metadata: HttpMetadata,
  owners: BrowserAccessOwners,
): Result<BrowserGrant> {
  const navigation = owners.admission.bootstrap(metadata);
  if (!navigation.ok) return navigation;
  return success({ kind: 'session-issued', setCookie: sessionCookie(owners) });
}

/** The `Set-Cookie` value: the session secret, HttpOnly, same-site only, for every path. */
function sessionCookie(owners: BrowserAccessOwners): string {
  return `${owners.admission.cookieName}=${owners.security.browserSession}; HttpOnly; SameSite=Strict; Path=/`;
}
