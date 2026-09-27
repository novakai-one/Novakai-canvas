/*
 * The HTTP ingress vocabulary: the loopback address, the two callers credential admission grants,
 * the raw and read request headers, the body limit and the browser cookie name. Declarations and
 * fixed constants (loopback IP, the two callers, body limit, cookie name); the security secrets and
 * the admission port are in ports/transport.ts. A refused request is the caller's to correct and
 * resend; Authoring owns commit and receipt recovery.
 */
import type { ActorId } from '../../brands.js';
import { actorId } from '../../schemas.js';

/** The only IPv4 address the server binds; its clients connect to it. */
export const loopbackIp = '127.0.0.1';

/**
 * One server's loopback address, built by adapters/credentials from the port. `host` is the exact
 * Host header admission accepts (`127.0.0.1:<port>`); `origin` is `http://` plus `host`.
 */
export interface LoopbackAddress {
  readonly host: string;
  readonly origin: string;
}

/**
 * Who a request speaks for: the browser (a human) or the local CLI (an agent). Only credential
 * admission grants one; submitted authorship cannot choose privileges.
 */
export type Caller =
  | { readonly kind: 'human'; readonly id: ActorId }
  | { readonly kind: 'agent'; readonly id: ActorId };

/** The caller the browser session cookie grants. Parsed once at module load; the ID is valid. */
export const BROWSER_CALLER: Extract<Caller, { readonly kind: 'human' }> = Object.freeze({
  kind: 'human',
  id: actorId.parse('human:browser'),
});

/**
 * The caller the local agent credential grants; also the actor of a resource selection request.
 * Parsed once at module load; the ID is valid.
 */
export const CLI_CALLER: Extract<Caller, { readonly kind: 'agent' }> = Object.freeze({
  kind: 'agent',
  id: actorId.parse('agent:cli'),
});

/** A request's headers as the socket reads them: lowercase names, each with every value sent. */
export type HeaderLists = Readonly<Record<string, readonly string[] | undefined>>;

/**
 * One request header, still untrusted: not sent, sent once with its text, or sent more than once.
 * A repeated header is ambiguous, so no admission check accepts it.
 */
export type HeaderValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'single'; readonly value: string }
  | { readonly kind: 'repeated' };

/** The request head admission reads. Untrusted until the ingress policy admits it. */
export interface HttpMetadata {
  /** The request method; empty text when the socket reports none. */
  readonly method: string;
  readonly host: HeaderValue;
  readonly origin: HeaderValue;
  /** `Sec-Fetch-Site`. */
  readonly site: HeaderValue;
  /** `Sec-Fetch-Mode`. */
  readonly mode: HeaderValue;
  /** `Sec-Fetch-Dest`. */
  readonly destination: HeaderValue;
  readonly authorization: HeaderValue;
  readonly cookie: HeaderValue;
  readonly contentType: HeaderValue;
}

/** The largest request body the socket reader accepts, in bytes (24 MiB). */
export const httpBodyLimit = 24 * 1024 * 1024;
/** The browser session cookie's base name; admission adds the loopback host. */
export const browserCookieName = 'novakai_canvas_session';
