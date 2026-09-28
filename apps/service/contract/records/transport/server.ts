/*
 * The HTTP server's startup options, its running handle, the file it sends as bytes, the answers
 * the transport policy gives the socket edge (which part answers a request, the browser grant)
 * and the fixed response headers; the HTTP status is in wire-codes.ts. Declarations and fixed
 * header constants. A failed start leaves the workspace with the caller, which closes it; clients
 * reconcile a retained request's receipt.
 */
import type { Result } from '../../errors.js';
import type { Generation, HostPath, LoopbackPort } from '../../brands.js';

/** Server-owned paths and port are explicit startup inputs, never request parameters. */
export interface ServerOptions {
  readonly port: LoopbackPort;
  readonly webRoot: HostPath;
  readonly credentialFile: HostPath;
}

/** A listening server: its loopback URL, its transport generation and its shutdown. */
export interface LocalServer {
  readonly url: string;
  readonly generation: Generation;
  close(): Promise<Result<void>>;
}

/** Bytes sent as they are: a built web app file or an export artifact. */
export interface StaticFile {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Which part of the server answers a request: `events` is the change stream, `api` the
 * authenticated API router, `browser` the built web app.
 */
export type RequestKind = 'events' | 'api' | 'browser';

/**
 * What browser access allows: the request already holds the session, or it is a navigation that
 * receives it through `setCookie` (a `Set-Cookie` header value).
 */
export type BrowserGrant =
  | { readonly kind: 'session-exists' }
  | { readonly kind: 'session-issued'; readonly setCookie: string };

/** Browser isolation headers on every JSON and bytes answer; exports never run as documents. */
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
