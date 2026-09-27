/*
 * The HTTP ingress policy: the loopback host check, the navigation that may bootstrap the browser
 * credential, browser-cookie and agent-bearer authentication, and mutation admission (Authoring's
 * request schema, exact authorship, the caller's planners). Pure; the host owns token storage and
 * constant-time equality (`HttpSecurity`). A refusal performs no owner mutation, so the caller
 * corrects its request and resends it; Authoring owns commit and receipt recovery.
 */
import type { Caller, HttpMetadata } from '../../contract/records/transport/http.js';
import type { HttpAdmission, HttpSecurity } from '../../contract/ports/transport.js';
import { browserCookieName } from '../../contract/records/transport/http.js';
import type { Request } from '../../contract/records/capabilities.js';
import type { PlannerId } from '../../contract/brands.js';
import { plannerId, requestSchema } from '../../contract/schemas.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** The identity the browser session cookie grants. */
const BROWSER_CALLER: Caller = Object.freeze({ id: 'human:browser', kind: 'human' });
/** The identity the local agent credential grants. */
const CLI_CALLER: Caller = Object.freeze({ id: 'agent:cli', kind: 'agent' });

/**
 * The public semantic planners each caller may address. Installation stays internal, and the agent
 * credential never grants the raw Model planner, whatever the payload claims.
 */
const PLANNERS: Readonly<Record<Caller['kind'], readonly PlannerId[]>> = Object.freeze({
  human: plannerIds('dsl', 'model', 'library'),
  agent: plannerIds('dsl', 'library', 'preset'),
});

/** The `Sec-Fetch-Site` values a bootstrap navigation may carry. */
const NAVIGATION_SITES: readonly string[] = Object.freeze(['none', 'same-origin']);

/**
 * Binds the ingress policy to one server's security. Every refusal is safe to correct and resend.
 * - `cookieName`: the browser session cookie name for this host.
 * - `bootstrap`: success for a direct navigation; `unauthorized` at `host` or `navigation`.
 * - `authenticate`: the caller; `unauthorized` at `host`, `session` or `credential`.
 * - `mutation`: the admitted request; `invalid-input` at `request`, or `unauthorized` at `actor`
 *   or `intent.planner`.
 */
export function createAdmission(security: HttpSecurity): HttpAdmission {
  return {
    cookieName: sessionCookieName(security.address.host),
    bootstrap: (metadata) => bootstrap(metadata, security),
    authenticate: (metadata) => authenticate(metadata, security),
    mutation: admitMutation,
  };
}

/**
 * The browser cookie name for one loopback host. Cookies ignore ports, so each server's name
 * carries its host and opening another app cannot replace this one's credential.
 */
function sessionCookieName(host: string): string {
  return `${browserCookieName}_${encodeURIComponent(host)}`;
}

/**
 * Whether this request may receive the browser credential: only a direct, top-level navigation;
 * fetch cannot bootstrap itself. Fails with `unauthorized` at `host` as `admitHost`, then at
 * `navigation` as `admitNavigation`.
 */
function bootstrap(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  const host = admitHost(metadata, security);
  if (!host.ok) return host;
  return admitNavigation(metadata, security);
}

/**
 * Rejects DNS rebinding before credentials, paths or body content reach an owner. Fails with
 * `unauthorized` at `host` unless the Host header is the configured loopback host.
 */
function admitHost(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  if (metadata.host !== security.address.host)
    return failure('unauthorized', 'host', 'Open the configured loopback address');
  return success(undefined);
}

/**
 * Fails with `unauthorized` at `navigation` unless the request is a `GET` document navigation
 * typed or started on this origin (`Sec-Fetch-Site` `none` or `same-origin`, no foreign Origin).
 */
function admitNavigation(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  const allowed =
    metadata.method === 'GET' &&
    metadata.mode === 'navigate' &&
    metadata.destination === 'document' &&
    NAVIGATION_SITES.includes(metadata.site) &&
    trustedOrigin(metadata, security);
  if (!allowed) return failure('unauthorized', 'navigation', 'Navigate directly to this workspace');
  return success(undefined);
}

/**
 * The authenticated caller: the agent when an Authorization header is present, the browser
 * otherwise. Fails with `unauthorized` at `host` as `admitHost`, at `session` as `browserCaller`
 * and at `credential` as `agentCaller`.
 */
function authenticate(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  const host = admitHost(metadata, security);
  if (!host.ok) return host;
  if (metadata.authorization.length === 0) return browserCaller(metadata, security);
  return agentCaller(metadata, security);
}

/**
 * The browser caller. Needs same-origin Fetch Metadata (missing metadata is refused), no foreign
 * Origin and the current HttpOnly session cookie. Fails with `unauthorized` at `session`
 * otherwise.
 */
function browserCaller(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  const allowed =
    metadata.site === 'same-origin' &&
    trustedOrigin(metadata, security) &&
    security.equal(sessionCookie(metadata.cookie, security.address.host), security.browserSession);
  if (!allowed)
    return failure('unauthorized', 'session', 'Reload this workspace from its loopback address');
  return success(BROWSER_CALLER);
}

/** Whether the Origin header is absent (empty) or exactly this server's origin. */
function trustedOrigin(
  metadata: HttpMetadata,
  security: HttpSecurity,
): boolean {
  return metadata.origin === '' || metadata.origin === security.address.origin;
}

/**
 * The session cookie's value from the Cookie header; empty when it is absent or repeated. A
 * repeated cookie is ambiguous, so neither a prefix nor a later injected value is accepted.
 */
function sessionCookie(
  header: string,
  host: string,
): string {
  const prefix = `${sessionCookieName(host)}=`;
  const [only, ...others] = header
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item.startsWith(prefix));
  if (only === undefined || others.length > 0) return '';
  return only.slice(prefix.length);
}

/**
 * The agent caller. The local credential is for the filesystem CLI, so a request carrying browser
 * metadata (Origin or `Sec-Fetch-Site`) is refused. Fails with `unauthorized` at `credential`
 * unless the bearer token matches.
 */
function agentCaller(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  const allowed =
    metadata.origin === '' &&
    metadata.site === '' &&
    security.equal(metadata.authorization, `Bearer ${security.agentToken}`);
  if (!allowed) return failure('unauthorized', 'credential', 'Use the local agent credential');
  return success(CLI_CALLER);
}

/**
 * The input as an Authoring request the caller may submit. Fails with `invalid-input` at
 * `request` when Authoring's request schema refuses it; otherwise as `admitActor`.
 */
function admitMutation(
  input: unknown,
  caller: Caller,
): Result<Request> {
  const request = requestSchema.safeParse(input);
  if (!request.success)
    return failure('invalid-input', 'request', 'Expected a complete version 1 Authoring request');
  return admitActor(request.data, caller);
}

/**
 * Fails with `unauthorized` at `actor` unless the submitted actor is exactly the authenticated
 * caller; otherwise as `admitPlanner`. Authorship is checked apart from malformed input.
 */
function admitActor(
  request: Request,
  caller: Caller,
): Result<Request> {
  const matches = request.actor.id === caller.id && request.actor.kind === caller.kind;
  if (!matches)
    return failure('unauthorized', 'actor', 'Submitted actor must match the authenticated caller');
  return admitPlanner(request, caller);
}

/**
 * Fails with `unauthorized` at `intent.planner` when a change names a planner the caller may not
 * address. Undo and redo name no planner and pass.
 */
function admitPlanner(
  request: Request,
  caller: Caller,
): Result<Request> {
  if (!permittedPlanner(request, caller))
    return failure(
      'unauthorized',
      'intent.planner',
      'This planner is not available to the authenticated caller',
    );
  return success(request);
}

/** Whether the request is an undo, a redo, or a change through one of the caller's planners. */
function permittedPlanner(
  request: Request,
  caller: Caller,
): boolean {
  if (request.intent.kind !== 'change') return true;
  return PLANNERS[caller.kind].includes(request.intent.planner);
}

/**
 * Brands a fixed list of planner ids with Authoring's `plannerId` and freezes it. Runs once at
 * module load on the literals above, which are all valid ids.
 */
function plannerIds(...ids: readonly string[]): readonly PlannerId[] {
  return Object.freeze(ids.map((id) => plannerId.parse(id)));
}
