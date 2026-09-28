/*
 * Why this file exists
 *
 * Most of what an agent does first is look: `describe`, `list`, `read my-diagram`, `inspect`.
 * Each asks the service one question and prints the answer. Reading never changes the workspace,
 * so a failed read can simply be run again.
 *
 * This file names those questions and what each gives back, already checked.
 * `adapters/service-http/reads.ts` asks the service.
 */
import type { CollectionId, RequestId } from '../brands.js';
import type { Result } from '../errors.js';
import type { InspectionReport, WorkspaceSnapshot } from '../records/foreign.js';
import type { ReadScope } from '../records/command.js';
import type {
  LanguageDescription,
  ServiceAnswer,
  Readout,
  ReceiptLookup,
} from '../records/service-answers.js';

/**
 * The questions the CLI asks the service. Each fails with `connection-uncertain`,
 * `invalid-response` (the answer isn't the expected shape) or `service-rejected` (the service
 * said no).
 */
export interface ServiceReads {
  /** Asks for the DSL vocabulary, which `describe` prints as JSON. */
  vocabulary(): Promise<Result<LanguageDescription>>;
  /**
   * Asks for every saved record in the workspace, and the service's generation (the label of one
   * service start; see `brands.ts`).
   */
  workspace(): Promise<Result<ServiceAnswer<WorkspaceSnapshot>>>;
  /** Asks for one collection's source, or only the section or object `scope` names. */
  source(
    collection: CollectionId,
    scope: ReadScope,
  ): Promise<Result<Readout>>;
  /** Asks for the service's report on one collection's layout, which `inspect` prints as JSON. */
  inspect(collection: CollectionId): Promise<Result<InspectionReport>>;
  /** Asks whether `request` was saved, with its receipt if it was, and the service's generation. */
  receipt(request: RequestId): Promise<Result<ServiceAnswer<ReceiptLookup>>>;
}
