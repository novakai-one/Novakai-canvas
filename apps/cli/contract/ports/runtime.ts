/*
 * What the service commands get injected: the HTTP transport, local files and the request
 * journal, the semantic readers and request IDs. Declarations only; compose binds the adapters.
 * Every method returns its failure as a value.
 */
import type {
  ByteBackup,
  ResourceFiles,
  ResourceSyntax,
  PresetInputs,
} from '../records/resources.js';
import type { LocalFailure, Result } from '../errors.js';
import type { Snapshot, Request, TransportResponse } from '../records/foreign.js';
import type { Command } from '../records/command.js';
import type { SourceFile } from '../records/source-file.js';
import type { AssetDigest, Generation, RequestId } from '../brands.js';
import type { ParsedSource } from '@novakai/canvas-language';
/** One service answer: the generation that sent it, checked, and the service's outcome, kept whole. */
export interface ServiceAnswer {
  readonly generation: Generation;
  readonly outcome: TransportResponse['outcome'];
}
/**
 * Sends one request to the local service. Fails only locally: `invalid-response` or
 * `connection-uncertain`. A service rejection arrives inside the answer's `outcome`.
 */
export interface Transport {
  get(path: string): Promise<Result<ServiceAnswer, LocalFailure>>;
  post(
    path: string,
    body: unknown,
  ): Promise<Result<ServiceAnswer, LocalFailure>>;
}
/** A request as retained: the generation it was sent under, the Authoring request and its byte backups (`[]` when none). */
export interface RequestDraft {
  readonly generation: Generation;
  readonly request: Request;
  readonly backups: readonly ByteBackup[];
}
export interface RequestFiles {
  /** The file's checked path and its text. Fails with `source-unavailable` or `source-too-large`. */
  source(path: string): Promise<Result<SourceFile, LocalFailure>>;
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
  admissionDigest(input: unknown): Result<AssetDigest>;
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
  nextRequestId(): RequestId;
}

/** Receipt lookup may be absent; claimed apply success requires this exact request's committed receipt. */
export interface ReceiptExpectation {
  readonly kind: 'lookup' | 'committed';
  readonly request: string;
}
