import type {
  ByteBackup,
  ResourceFiles,
  ResourceSyntax,
  PresetInputs,
} from '../records/resources.js';
import type { LocalFailure, Result } from '../errors.js';
import type { Snapshot, Request, TransportResponse } from '../records/foreign.js';
import type { Command } from '../records/command.js';
import type { ParsedSource } from '@novakai/canvas-language';
/**
 * Sends one request to the local service. Fails only locally: `invalid-response` or
 * `connection-uncertain`. A service rejection arrives inside the envelope's `outcome`.
 */
export interface Transport {
  get(path: string): Promise<Result<TransportResponse, LocalFailure>>;
  post(
    path: string,
    body: unknown,
  ): Promise<Result<TransportResponse, LocalFailure>>;
}
export interface RequestDraft {
  readonly generation: string;
  readonly backups?: readonly ByteBackup[] | undefined;
  readonly request: Request;
}
export interface RequestFiles {
  /** Fails with `source-unavailable` or `source-too-large`. */
  source(path: string): Promise<Result<string, LocalFailure>>;
  save(draft: RequestDraft): Promise<Result<void>>;
  read(id: string): Promise<Result<RequestDraft>>;
  /** Fails with `output-unavailable`. */
  output(
    path: string,
    text: string,
  ): Promise<Result<void, LocalFailure>>;
}
export interface SemanticInputs extends ResourceSyntax {
  profileParse(source: string): Result<ParsedSource>;
  checkedRequest(input: unknown): Result<Request>;
  admissionDigest(input: unknown): Result<string>;
  backup(input: unknown): Result<ByteBackup>;
  snapshot(input: unknown): Result<Snapshot>;
  request(
    command: Command,
    source: string,
    snapshot: Snapshot,
    id: string,
  ): Result<Request>;
  readout(input: unknown): Result<string>;
  collections(input: unknown): Result<string>;
  receipt(
    input: unknown,
    expected: ReceiptExpectation,
  ): Result<string>;
  /** An apply answer carries the receipt beside the committed snapshot; the CLI reports only the receipt. */
  applied(
    input: unknown,
    request: string,
  ): Result<string>;
}
/** Narrow effects are bound once at CLI composition. Tests exercise the same flow without booting a process or server. */
export interface CliDependencies {
  readonly transport: Transport;
  readonly files: RequestFiles;
  readonly resourceFiles: ResourceFiles;
  readonly presets: PresetInputs;
  readonly semantic: SemanticInputs;
  nextRequestId(): string;
}

/** Receipt lookup may be absent; claimed apply success requires this exact request's committed receipt. */
export interface ReceiptExpectation {
  readonly kind: 'lookup' | 'committed';
  readonly request: string;
}
