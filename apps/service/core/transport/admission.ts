import type {
  Caller,
  HttpAdmission,
  HttpMetadata,
  HttpSecurity,
  MutationOwner,
} from '../../contract/records/transport/http.js';
import { sessionCookieName } from './session-cookie.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { Request } from '../../contract/records/capabilities.js';

/** Reject DNS rebinding before credentials, paths or body content can reach an owner. */
function admitHost(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  if (metadata.host !== security.host)
    return failure('unauthorized', 'host', 'Open the configured loopback address');
  return { ok: true, value: undefined };
}
/** Only a direct, top-level navigation can establish the browser credential; fetch cannot bootstrap itself. */
function bootstrap(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  const host = admitHost(metadata, security);
  if (!host.ok) return host;
  return admitNavigation(metadata, security);
}
/** Navigation metadata is evaluated only after the host has been admitted. */
function admitNavigation(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<void> {
  const allowed =
    metadata.method === 'GET' &&
    metadata.mode === 'navigate' &&
    metadata.destination === 'document' &&
    ['none', 'same-origin'].includes(metadata.site) &&
    ['', security.origin].includes(metadata.origin);
  if (!allowed) return failure('unauthorized', 'navigation', 'Navigate directly to this workspace');
  return { ok: true, value: undefined };
}
/** Duplicate cookies are ambiguous and rejected instead of accepting a prefix or a later injected value. */
function sessionCookie(
  header: string,
  host: string,
): string {
  const prefix = `${sessionCookieName(host)}=`;
  const values = header
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item.startsWith(prefix));
  if (values.length !== 1) return '';
  return values[0]?.slice(prefix.length) ?? '';
}
/** Browser requests need both same-origin metadata and the current HttpOnly session. Missing Fetch Metadata is rejected. */
function browserCaller(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  const trustedOrigin = ['', security.origin].includes(metadata.origin);
  const allowed =
    metadata.site === 'same-origin' &&
    trustedOrigin &&
    security.equal(sessionCookie(metadata.cookie, security.host), security.browserSession);
  if (!allowed)
    return failure('unauthorized', 'session', 'Reload this workspace from its loopback address');
  return { ok: true, value: { id: 'human:browser', kind: 'human' } };
}
/** CLI credentials never grant the human Model planner, even if a payload claims to be human. */
function authenticate(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  const host = admitHost(metadata, security);
  if (!host.ok) return host;
  if (metadata.authorization.length === 0) return browserCaller(metadata, security);
  return agentCaller(metadata, security);
}
/** A browser-originated bearer request is refused; the local credential is intended for the filesystem CLI. */
function agentCaller(
  metadata: HttpMetadata,
  security: HttpSecurity,
): Result<Caller> {
  const allowed =
    metadata.origin === '' &&
    metadata.site === '' &&
    security.equal(metadata.authorization, `Bearer ${security.agentToken}`);
  if (!allowed) return failure('unauthorized', 'credential', 'Use the local agent credential');
  return { ok: true, value: { id: 'agent:cli', kind: 'agent' } };
}
/** Public semantic planners are transport-addressable; installation and raw Model authoring remain restricted. */
function permittedPlanner(
  request: Request,
  caller: Caller,
): boolean {
  if (request.intent.kind !== 'change') return true;
  const allowed = { human: ['dsl', 'model', 'library'], agent: ['dsl', 'library', 'preset'] };
  return allowed[caller.kind].includes(request.intent.planner);
}
/** Parse with Authoring's schema, then require exact authenticated authorship and the caller's planner policy. */
function mutation(
  input: unknown,
  caller: Caller,
  owner: MutationOwner,
): Result<Request> {
  const request = owner.read(input);
  if (!request.ok) return request;
  return admitActor(request.value, caller);
}
/** Authorship mismatch is reported separately from malformed input and planner privileges. */
function admitActor(
  request: Request,
  caller: Caller,
): Result<Request> {
  const matches = request.actor.id === caller.id && request.actor.kind === caller.kind;
  if (!matches)
    return failure('unauthorized', 'actor', 'Submitted actor must match the authenticated caller');
  return plannerRequest(request, caller);
}
/** Credential-derived identity is copied into the admitted envelope; planner rejection performs no owner mutation. */
function plannerRequest(
  request: Request,
  caller: Caller,
): Result<Request> {
  if (!permittedPlanner(request, caller))
    return failure(
      'unauthorized',
      'intent.planner',
      'This planner is not available to the authenticated caller',
    );
  return { ok: true, value: request };
}
/** Bind a pure ingress policy. Hosts own token storage and constant-time equality; failed admission is safe to correct and retry. */
export function createAdmission(
  security: HttpSecurity,
  owner: MutationOwner,
): HttpAdmission {
  return {
    cookieName: sessionCookieName(security.host),
    bootstrap: (metadata) => bootstrap(metadata, security),
    authenticate: (metadata) => authenticate(metadata, security),
    mutation: (input, caller) => mutation(input, caller, owner),
  };
}
