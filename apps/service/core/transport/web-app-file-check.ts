/*
 * Why this file exists
 *
 * The web app's own files must only go to a browser that opened the page, and the browser needs a
 * way to get its session cookie in the first place. For example, opening `http://127.0.0.1:5174`
 * gives the browser the cookie, and its later request for the app's script must carry it.
 *
 * This file decides whether a web app file may be sent, and gives out the cookie only when the
 * browser opens the page directly. It uses the checks in admission.ts. It never gives the cookie to
 * any other request.
 */
import type { HttpAdmission, HttpSecurity } from '../../contract/ports/transport.js';
import type { HttpMetadata } from '../../contract/records/transport/http.js';
import type { BrowserGrant } from '../../contract/records/transport/server.js';
import { success, type Result } from '../../contract/errors.js';
import { headerMatches } from './http-metadata.js';

/**
 * What the check uses: admission's checks and the cookie's name, and the session secret that the
 * cookie carries.
 */
export interface WebAppFileCheckDependencies {
  readonly admission: Pick<HttpAdmission, 'checkNavigation' | 'authenticate' | 'cookieName'>;
  readonly security: Pick<HttpSecurity, 'browserSession'>;
}

/** The grant for a request that already holds the session. */
const SESSION_EXISTS: BrowserGrant = Object.freeze({ kind: 'session-exists' });

/**
 * Builds the check that decides whether a web app file may be sent. A direct page open
 * (`Sec-Fetch-Mode: navigate`) answers `session-issued`, carrying the `Set-Cookie` header text to
 * send; any other request must already hold the cookie (`session-exists`). Every refusal is
 * `unauthorized`.
 */
export function createWebAppFileCheck(
  dependencies: WebAppFileCheckDependencies,
): (metadata: HttpMetadata) => Result<BrowserGrant> {
  return (metadata) => checkWebAppFile(metadata, dependencies);
}

/** A navigation as `issuedSession`; any other request as `existingSession`. */
function checkWebAppFile(
  metadata: HttpMetadata,
  dependencies: WebAppFileCheckDependencies,
): Result<BrowserGrant> {
  if (!headerMatches(metadata.mode, 'navigate')) return existingSession(metadata, dependencies);
  return issuedSession(metadata, dependencies);
}

/**
 * A resource fetch reuses the established session only. Fails as admission `authenticate`:
 * `unauthorized` at `host`, `session` or `credential`.
 */
function existingSession(
  metadata: HttpMetadata,
  dependencies: WebAppFileCheckDependencies,
): Result<BrowserGrant> {
  const caller = dependencies.admission.authenticate(metadata);
  if (!caller.ok) return caller;
  return success(SESSION_EXISTS);
}

/**
 * Only a navigation may receive the session cookie. Fails as admission `checkNavigation`:
 * `unauthorized` at `host` or `navigation`.
 */
function issuedSession(
  metadata: HttpMetadata,
  dependencies: WebAppFileCheckDependencies,
): Result<BrowserGrant> {
  const navigation = dependencies.admission.checkNavigation(metadata);
  if (!navigation.ok) return navigation;
  return success({ kind: 'session-issued', setCookie: sessionCookie(dependencies) });
}

/** The `Set-Cookie` value: the session secret, HttpOnly, same-site only, for every path. */
function sessionCookie(dependencies: WebAppFileCheckDependencies): string {
  return `${dependencies.admission.cookieName}=${dependencies.security.browserSession}; HttpOnly; SameSite=Strict; Path=/`;
}
