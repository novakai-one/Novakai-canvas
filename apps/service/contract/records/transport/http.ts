/*
 * The HTTP ingress vocabulary: the authenticated caller, the untrusted request headers, the
 * server's security secrets, the ingress admission port, the body limit and the browser cookie
 * name. Declarations only. A refused request is the caller's to correct and resend; Authoring owns
 * commit and receipt recovery.
 */
import type { Result } from '../../errors.js';
import type { Request } from '../capabilities.js';
/** Transport identities are minted by credential admission; submitted authorship cannot choose privileges. */
export interface Caller {
  readonly id: string;
  readonly kind: 'human' | 'agent';
}
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
/**
 * One server's loopback address and secrets. The host keeps the tokens and supplies `equal`, a
 * constant-time comparison of untrusted text with a secret.
 */
export interface HttpSecurity {
  readonly host: string;
  readonly origin: string;
  readonly browserSession: string;
  readonly agentToken: string;
  readonly generation: string;
  equal(
    left: string,
    right: string,
  ): boolean;
}
/**
 * The ingress policy (core/transport/admission.ts). Restart changes generation and browser
 * credential, while the persisted agent credential stays local.
 */
export interface HttpAdmission {
  readonly cookieName: string;
  bootstrap(metadata: HttpMetadata): Result<void>;
  authenticate(metadata: HttpMetadata): Result<Caller>;
  mutation(
    input: unknown,
    caller: Caller,
  ): Result<Request>;
}
/** The largest request body the socket reader accepts, in bytes (24 MiB). */
export const httpBodyLimit = 24 * 1024 * 1024;
/** The browser session cookie's base name; admission adds the loopback host. */
export const browserCookieName = 'novakai_canvas_session';
