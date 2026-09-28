/*
 * Why this file exists
 *
 * The service listens only at `127.0.0.1`, and only two callers may use it: the web app in a
 * browser, and the CLI. Deciding who is calling means reading a few request headers. For example,
 * `Host: 127.0.0.1:5174` with the right `Authorization: Bearer …` token is the CLI.
 *
 * This file holds the words and fixed values for that decision: the address, the two callers, the
 * request headers, the largest body accepted and the cookie's name. The secrets and the admission
 * rules are in ports/transport.ts.
 */
import type { ActorId } from '../../brands.js';
import { actorId } from '../../schemas.js';

/** The only address the server listens on, and the one its callers connect to. */
export const loopbackIp = '127.0.0.1';

/** One server's address, built by adapters/credentials from its port. */
export interface LoopbackAddress {
  /** The exact `Host` header admission accepts, for example `127.0.0.1:5174`. */
  readonly host: string;
  /** `http://` plus `host`, for example `http://127.0.0.1:5174`. */
  readonly origin: string;
}

/**
 * Who a request speaks for: the browser (a person) or the CLI (an agent). Only admission decides
 * this, from the cookie or token. A request can't choose it by claiming an author.
 */
export type Caller =
  | { readonly kind: 'human'; readonly id: ActorId }
  | { readonly kind: 'agent'; readonly id: ActorId };

/** The caller a valid browser session cookie stands for. Its ID is checked once, when loaded. */
export const BROWSER_CALLER: Extract<Caller, { readonly kind: 'human' }> = Object.freeze({
  kind: 'human',
  id: actorId.parse('human:browser'),
});

/**
 * The caller a valid agent token stands for. Also the author of the stand-in request that preset
 * preparation builds to pick a preset's files. Its ID is checked once, when loaded.
 */
export const CLI_CALLER: Extract<Caller, { readonly kind: 'agent' }> = Object.freeze({
  kind: 'agent',
  id: actorId.parse('agent:cli'),
});

/** A request's headers as the socket reads them: lowercase names, each with every value sent. */
export type HeaderLists = Readonly<Record<string, readonly string[] | undefined>>;

/**
 * One request header, not yet trusted: not sent, sent once with its text, or sent more than once.
 * A repeated header is unclear, so no admission check accepts it.
 */
export type HeaderValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'single'; readonly value: string }
  | { readonly kind: 'repeated' };

/** The method and headers admission reads. Not trusted until admission accepts them. */
export interface HttpMetadata {
  /** The request method; empty text when the socket reports none. */
  readonly method: string;
  /** `Host`. */
  readonly host: HeaderValue;
  /** `Origin`. */
  readonly origin: HeaderValue;
  /** `Sec-Fetch-Site`: whether the browser says the request came from this site. */
  readonly site: HeaderValue;
  /** `Sec-Fetch-Mode`: `navigate` when the browser is opening a page. */
  readonly mode: HeaderValue;
  /** `Sec-Fetch-Dest`: `document` when the request is for a whole page. */
  readonly destination: HeaderValue;
  /** `Authorization`: the CLI's `Bearer` token. */
  readonly authorization: HeaderValue;
  /** `Cookie`: the browser's session cookie. */
  readonly cookie: HeaderValue;
  /** `Content-Type`. */
  readonly contentType: HeaderValue;
}

/** The largest request body accepted, in bytes (24 MiB). */
export const httpBodyLimit = 24 * 1024 * 1024;
/** The start of the browser session cookie's name; admission adds the server's host to it. */
export const browserCookieName = 'novakai_canvas_session';
