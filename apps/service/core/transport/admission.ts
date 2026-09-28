/*
 * Why this file exists
 *
 * Any program on this computer can send requests to `127.0.0.1`, even a web page open in another
 * tab. For example, a page from another site could try to post a change to
 * `/api/v1/authoring/apply`. Only the web app and the CLI may get in.
 *
 * This file decides who gets in: the browser with its session cookie, the CLI with its token, and
 * only at this server's own address (the `Host` header). It also checks a change request: its
 * author must be the caller, and it must be a kind of change the caller may send. It never keeps or
 * compares the secrets itself, and never runs a change.
 */
import type { Caller, HeaderValue, HttpMetadata } from '../../contract/records/transport/http.js';
import type { HttpAdmission, HttpSecurity } from '../../contract/ports/transport.js';
import {
  BROWSER_CALLER,
  CLI_CALLER,
  browserCookiePrefix,
} from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { admitChange } from './change-admission.js';
import { headerMatches, headerText } from './http-metadata.js';

/** The `Sec-Fetch-Site` values a bootstrap navigation may carry. */
const NAVIGATION_SITES: readonly string[] = Object.freeze(['none', 'same-origin']);

/** What a missing or ambiguous session cookie reads as: empty text, which never equals the secret. */
const NO_SESSION_COOKIE = '';

/**
 * Builds the checks that decide who may use this server, from its address and secrets.
 * `checkNavigation(metadata)` passes a direct page open; `authenticate(metadata)` answers the
 * `Caller`; `admitChange(input, caller)` answers the checked change `Request`; `cookieName` names
 * the session cookie. Refusals are `unauthorized`, or `invalid-input` for a malformed change.
 */
export function createAdmission(security: HttpSecurity): HttpAdmission {
  return {
    cookieName: sessionCookieName(security.address.host),
    checkNavigation: (metadata) => checkNavigation(metadata, security),
    authenticate: (metadata) => authenticate(metadata, security),
    admitChange,
  };
}

/**
 * Names the browser cookie for one loopback host. Cookies ignore ports, so each server's name
 * carries its host and opening another app cannot replace this one's credential.
 */
function sessionCookieName(host: string): string {
  const encodedHost = encodeURIComponent(host);
  return `${browserCookiePrefix}_${encodedHost}`;
}

/**
 * Checks the request is the browser opening the page directly at this server's own address, the
 * only request that may receive the session cookie; a fetch cannot give itself one.
 */
function checkNavigation(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  if (!isOwnHost(metadata, security)) {
    return wrongHostFailure();
  }
  if (!isDirectPageOpen(metadata, security)) {
    return notDirectPageOpenFailure();
  }
  return success(undefined);
}

/**
 * Works out who is calling: the browser when there is no Authorization header (or it is empty),
 * the CLI otherwise. A repeated Authorization header goes to the CLI check, which refuses it.
 */
function authenticate(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  if (!isOwnHost(metadata, security)) {
    return wrongHostFailure();
  }
  if (isBlankHeader(metadata.authorization)) {
    return checkBrowserCaller(metadata, security);
  }
  return checkAgentCaller(metadata, security);
}

/**
 * Whether the one Host header is this server's loopback host. Checked before anything else, so a
 * DNS rebinding page never reaches the credentials, paths or body.
 */
function isOwnHost(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  return headerMatches(metadata.host, security.address.host);
}

/** Whether the request opens a page and was typed by the person or started on this server. */
function isDirectPageOpen(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  return isPageOpen(metadata) && isStartedHere(metadata, security);
}

/** Whether the request is a `GET` that opens a whole page (`navigate` mode, `document` target). */
function isPageOpen(metadata: HttpMetadata): boolean {
  const isGet = metadata.method === 'GET';
  const navigates = headerMatches(metadata.mode, 'navigate');
  const opensDocument = headerMatches(metadata.destination, 'document');
  return isGet && navigates && opensDocument;
}

/**
 * Whether the page open was typed or started on this origin (`Sec-Fetch-Site` `none` or
 * `same-origin`), with no foreign Origin.
 */
function isStartedHere(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  const navigationSite = isNavigationSite(metadata.site);
  return navigationSite && isTrustedOrigin(metadata, security);
}

/** Whether the `Sec-Fetch-Site` header, sent once, is one a direct page open may carry. */
function isNavigationSite(site: HeaderValue): boolean {
  return NAVIGATION_SITES.some((allowedSite) => headerMatches(site, allowedSite));
}

/** Checks the browser is calling from this server's page with the current session cookie. */
function checkBrowserCaller(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  if (!isBrowserSession(metadata, security)) {
    return noBrowserSessionFailure();
  }
  return success(BROWSER_CALLER);
}

/**
 * Whether the request is a same-origin fetch that carries the current session cookie. Missing
 * Fetch Metadata counts as not same-origin.
 */
function isBrowserSession(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  return isSameOriginFetch(metadata, security) && hasCurrentSessionCookie(metadata, security);
}

/** Whether the browser says the request came from this site, with no foreign Origin. */
function isSameOriginFetch(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  const sameOrigin = headerMatches(metadata.site, 'same-origin');
  return sameOrigin && isTrustedOrigin(metadata, security);
}

/** Whether the Origin header is missing, empty, or exactly this server's origin; never repeated. */
function isTrustedOrigin(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  const ownOrigin = headerMatches(metadata.origin, security.address.origin);
  return isBlankHeader(metadata.origin) || ownOrigin;
}

/** Whether the request's session cookie equals the session secret (compared in constant time). */
function hasCurrentSessionCookie(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  const sessionCookie = readSessionCookie(metadata.cookie, security.address.host);
  return security.equal(sessionCookie, security.browserSession);
}

/** Reads the session cookie's value from the Cookie header; none when the header is repeated. */
function readSessionCookie(
  header: HeaderValue,
  host: string,
): string {
  if (header.kind === 'repeated') {
    return NO_SESSION_COOKIE;
  }
  return findSessionCookie(headerText(header), host);
}

/**
 * Finds the session cookie's value in the Cookie header text; none when it is missing or sent
 * twice. A repeated cookie is unclear, so neither a prefix nor a later injected value counts.
 */
function findSessionCookie(
  cookieHeader: string,
  host: string,
): string {
  const cookieStart = `${sessionCookieName(host)}=`;
  const [onlyCookie, ...otherCookies] = cookiesStartingWith(cookieHeader, cookieStart);
  if (onlyCookie === undefined) {
    return NO_SESSION_COOKIE;
  }
  if (otherCookies.length > 0) {
    return NO_SESSION_COOKIE;
  }
  return onlyCookie.slice(cookieStart.length);
}

/** Lists the cookies in the Cookie header text that start with `cookieStart`, spaces trimmed. */
function cookiesStartingWith(
  cookieHeader: string,
  cookieStart: string,
): readonly string[] {
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  return cookies.filter((cookie) => cookie.startsWith(cookieStart));
}

/**
 * Checks the CLI is calling with its bearer token. The token is for the CLI only, so a request
 * that also carries browser headers is refused.
 */
function checkAgentCaller(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  if (carriesBrowserHeaders(metadata)) {
    return noAgentCredentialFailure();
  }
  if (!isAgentBearer(metadata.authorization, security)) {
    return noAgentCredentialFailure();
  }
  return success(CLI_CALLER);
}

/** Whether the request sent an Origin or `Sec-Fetch-Site` header with text, as a browser does. */
function carriesBrowserHeaders(metadata: HttpMetadata): boolean {
  const originSent = !isBlankHeader(metadata.origin);
  const siteSent = !isBlankHeader(metadata.site);
  return originSent || siteSent;
}

/** Whether the Authorization header, sent once, is the agent bearer token (constant time). */
function isAgentBearer(
  header: HeaderValue,
  security: HttpSecurity,
): boolean {
  if (header.kind === 'repeated') {
    return false;
  }
  const bearerToken = `Bearer ${security.agentToken}`;
  return security.equal(headerText(header), bearerToken);
}

/** Whether the header is missing or sent once with empty text. A repeated header is not blank. */
function isBlankHeader(header: HeaderValue): boolean {
  return headerMatches(header, '');
}

/** Makes the mistake for a Host header that isn't this server's loopback host. */
function wrongHostFailure(): Result<never> {
  return failure('unauthorized', 'host', 'Open the configured loopback address');
}

/** Makes the mistake for a request that may not receive the cookie: not a direct page open. */
function notDirectPageOpenFailure(): Result<never> {
  return failure('unauthorized', 'navigation', 'Navigate directly to this workspace');
}

/** Makes the mistake for a browser request without this server's page and session cookie. */
function noBrowserSessionFailure(): Result<never> {
  return failure('unauthorized', 'session', 'Reload this workspace from its loopback address');
}

/** Makes the mistake for a CLI request without the one bearer token, or with browser headers. */
function noAgentCredentialFailure(): Result<never> {
  return failure('unauthorized', 'credential', 'Use the local agent credential');
}
