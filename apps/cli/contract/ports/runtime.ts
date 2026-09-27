/*
 * What the service commands get injected: the HTTP transport, local files, the request journal,
 * the resource reader, the semantic and preset readers, and request IDs. Declarations only;
 * compose binds the adapters. Every method returns its failure as a value.
 */
import type { LocalFiles } from './local-files.js';
import type { HttpTransport } from './http-transport.js';
import type { RequestJournal } from './request-journal.js';
import type { ResourceReader } from './resource-reader.js';
import type { Result } from '../errors.js';
import type {
  Admission,
  ParsedSource,
  Request,
  ResourceRequest,
  Snapshot,
} from '../records/foreign.js';
import type { ByteBackup } from '../records/retained-request.js';
import type { AssetBinding } from '../records/staged-resource.js';
import type { AdmitCommand, ChangeIntent } from '../records/command.js';
import type { AssetDigest, RequestId } from '../brands.js';

/** The resource declarations of a DSL source, read by Language. Fails with `invalid-source`. */
export interface ResourceSyntax {
  requests(source: string): Result<readonly ResourceRequest[]>;
}

export interface SemanticInputs extends ResourceSyntax {
  profileParse(source: string): Result<ParsedSource>;
  checkedRequest(input: unknown): Result<Request>;
  admissionDigest(input: unknown): Result<AssetDigest>;
  backup(input: unknown): Result<ByteBackup>;
  snapshot(input: unknown): Result<Snapshot>;
  request(
    intent: ChangeIntent,
    source: string,
    snapshot: Snapshot,
    id: RequestId,
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
    request: RequestId,
  ): Result<string>;
}

/** A preset file's Templates admission and the font or image declarations to stage first. */
export interface PresetSource {
  readonly admission: Admission;
  readonly resources: readonly ResourceRequest[];
}

/** Preset inputs use semantic sources and exact owner-prepared identities, never JSON coordinates. */
export interface PresetInputs {
  /** The admission of `theme admit` or `recipe admit`. Fails with `invalid-theme`, `duplicate-token` or `invalid-source`. */
  source(
    command: AdmitCommand,
    source: string,
  ): Result<PresetSource>;
  /** The Authoring request for a prepared preset. Fails with `invalid-response`. */
  request(
    input: unknown,
    snapshot: Snapshot,
    id: RequestId,
    assets: readonly AssetBinding[],
  ): Result<Request>;
}

/** Narrow effects are bound once at CLI composition. */
export interface CliDependencies {
  readonly transport: HttpTransport;
  readonly files: LocalFiles;
  readonly journal: RequestJournal;
  readonly resources: ResourceReader;
  readonly presets: PresetInputs;
  readonly semantic: SemanticInputs;
  nextRequestId(): RequestId;
}

/** Receipt lookup may be absent; claimed apply success requires this exact request's committed receipt. */
export interface ReceiptExpectation {
  readonly kind: 'lookup' | 'committed';
  readonly request: RequestId;
}
