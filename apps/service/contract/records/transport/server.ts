/*
 * Why this file exists
 *
 * `pnpm dev` starts the HTTP server with a port and two paths, and later stops it. While it runs,
 * the server sends JSON answers, files (the web app's and export files) and a change stream. For
 * example, every answer carries `X-Frame-Options: DENY`, so no other site can frame the app.
 *
 * This file declares what the server starts with, the running server, a file it sends, which part
 * answers a request, whether a browser may load the app, and the fixed headers on every answer.
 * Declarations and fixed values only. If the server fails to start, the caller still has the
 * workspace, and closes it.
 */
import type { Result } from '../../errors.js';
import type { Generation, HostPath, LoopbackPort } from '../../brands.js';

/** What the server is started with. No request can change them. */
export interface ServerOptions {
  readonly port: LoopbackPort;
  /** The folder of the built web app. */
  readonly webRoot: HostPath;
  /** The file that holds the CLI's token. Created on the first start. */
  readonly credentialFile: HostPath;
}

/** A running server. */
export interface LocalServer {
  /** Its address, for example `http://127.0.0.1:5174`. */
  readonly url: string;
  /** The label of this server run (see `Generation`). */
  readonly generation: Generation;
  /** Stops taking requests and closes the socket. */
  close(): Promise<Result<void>>;
}

/** A file the server sends as it is: one of the web app's files, or a newly made export file. */
export interface SentFile {
  readonly bytes: Uint8Array;
  /** Its `Content-Type`, for example `image/png`. */
  readonly mediaType: string;
  /** The name to save it as, when it is a download. */
  readonly filename?: string;
  /** Extra headers to send with it. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Which part of the server answers a request: `events` the change stream, `api` the API router
 * (after admission), `browser` the built web app.
 */
export type RequestKind = 'events' | 'api' | 'browser';

/**
 * Why a browser may load the app: it already has the session cookie, or it is opening the page
 * directly and is given the cookie now (`setCookie` is the `Set-Cookie` header value).
 */
export type BrowserGrant =
  | { readonly kind: 'session-exists' }
  | { readonly kind: 'session-issued'; readonly setCookie: string };

/**
 * The headers on every JSON answer and file. They keep answers out of caches, out of frames and
 * away from other sites, and stop an export file from running as a page.
 */
export const isolationHeaders: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
});

/** The headers of the change stream (`GET /api/v1/events`). */
export const eventStreamHeaders: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});
