import type { Result } from '../errors.js';
export interface BinaryResponse {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename: string | null;
  readonly revision: number | null;
}
import type { Receipt, TransportResponse } from '../records/owners.js';
/** A committed event's identity: the request that committed and the workspace sequence it reached. */
export interface CommitNotice {
  readonly request: Receipt['request'];
  readonly sequence: Receipt['sequence'];
}
/** Browser transport relies exclusively on the HttpOnly same-origin cookie. No bearer credential reaches JavaScript. */
export interface ServiceClient {
  get(
    path: string,
    signal?: AbortSignal,
  ): Promise<Result<TransportResponse>>;
  post(
    path: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<Result<TransportResponse>>;
  bytes?: (path: string, input: unknown, signal?: AbortSignal) => Promise<Result<BinaryResponse>>;
  /** `changed` receives null when nothing identifies a commit (a (re)connect or an unreadable event): reread. */
  changes(
    changed: (commit: CommitNotice | null) => void,
    connection: (connected: boolean) => void,
  ): () => void;
}
