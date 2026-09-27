/*
 * The HTTP ingress vocabulary: the loopback address, the authenticated caller, the raw and read
 * request headers, the body limit and the browser cookie name. Declarations and three fixed
 * constants (loopback IP, body limit, cookie name); the security secrets and the admission port
 * are in ports/transport.ts. A refused request is the caller's to correct and resend; Authoring
 * owns commit and receipt recovery.
 */

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

/** Transport identities are minted by credential admission; submitted authorship cannot choose privileges. */
export interface Caller {
  readonly id: string;
  readonly kind: 'human' | 'agent';
}
/** A request's headers as the socket reads them: lowercase names, each with every value sent. */
export type HeaderLists = Readonly<Record<string, readonly string[] | undefined>>;
/** Header values remain untrusted until the ingress policy admits the exact configured origin. */
export interface HttpMetadata {
  readonly method: string;
  readonly host: string;
  readonly origin: string;
  readonly site: string;
  readonly mode: string;
  readonly destination: string;
  readonly authorization: string;
  readonly cookie: string;
  readonly contentType: string;
}
/** The largest request body the socket reader accepts, in bytes (24 MiB). */
export const httpBodyLimit = 24 * 1024 * 1024;
/** The browser session cookie's base name; admission adds the loopback host. */
export const browserCookieName = 'novakai_canvas_session';
