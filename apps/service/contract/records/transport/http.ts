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
/** Restart changes generation and browser credential, while the persisted agent credential stays local. */
export interface HttpAdmission {
  readonly cookieName: string;
  bootstrap(metadata: HttpMetadata): Result<void>;
  authenticate(metadata: HttpMetadata): Result<Caller>;
  mutation(
    input: unknown,
    caller: Caller,
  ): Result<Request>;
}
export interface MutationOwner {
  read(input: unknown): Result<Request>;
}
export const httpBodyLimit = 24 * 1024 * 1024;
export const browserCookieName = 'novakai_canvas_session';
