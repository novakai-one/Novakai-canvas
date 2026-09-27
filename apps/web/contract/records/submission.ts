import type { Request, Receipt, Snapshot, Collection } from './owners.js';
import type { Result, Diagnostic } from '../errors.js';
import type { ServiceClient } from '../ports/client.js';
import type { DraftRetention } from '../ports/draft-retention.js';

/** Immutable intent is retained before transmission; uncertain recovery always uses this exact request ID and body. */
export interface Submission {
  readonly request: Request;
  readonly generation: string;
  readonly sourceEdit: number;
  readonly gesture: string | null;
  readonly state: 'sending' | 'uncertain' | 'retryable' | 'rejected';
}
/** The workspace an apply answer committed, checked by the same reader as a workspace read. */
export interface CarriedSnapshot {
  readonly snapshot: Snapshot;
  readonly collections: readonly Collection[];
}
/** A checked apply answer: this request's own receipt and the workspace it committed. */
export interface AppliedCommit {
  readonly receipt: Receipt;
  readonly carried: CarriedSnapshot;
}
export interface SubmissionReaders {
  pending(input: unknown): Result<readonly Submission[]>;
  receipt(
    input: unknown,
    request: Request,
  ): Result<Receipt | null>;
  applied(
    input: unknown,
    request: Request,
  ): Result<AppliedCommit>;
}
/** Browser owns recovery; the service receipt is the only evidence of success. No network retry is automatic. */
export interface SubmissionSession {
  restore(workspace: string): void;
  dismiss(id: string): Result<void>;
  submit(input: Omit<Submission, 'state'>): Promise<Result<Receipt>>;
  reconcile(id: string): Promise<Result<Receipt | null>>;
  retry(
    id: string,
    generation: string,
  ): Promise<Result<Receipt>>;
}
export interface SubmissionBindings {
  readonly client: Pick<ServiceClient, 'get' | 'post'>;
  readonly retention: DraftRetention;
  readonly readers: SubmissionReaders;
  changed(pending: readonly Submission[]): void;
  /** The carried snapshot comes only with an apply answer; a receipt lookup confirms without one. */
  confirmed(
    submission: Submission,
    receipt: Receipt,
    carriedSnapshot?: CarriedSnapshot,
  ): void;
  report(error: Diagnostic): void;
}

/** Factory delays callback binding until the workspace controller exists; composition supplies the concrete adapter. */
export type SubmissionFactory = (
  callbacks: Pick<SubmissionBindings, 'changed' | 'confirmed' | 'report'>,
) => SubmissionSession;
