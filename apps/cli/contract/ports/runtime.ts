/*
 * What the service commands get injected: the service calls, local files, the request journal,
 * the resource reader, Model's collection check, the semantic and preset readers, and request IDs.
 * Declarations only; compose binds the adapters. Every method returns its failure as a value.
 */
import type { CollectionReader } from './collection-reader.js';
import type { LocalFiles } from './local-files.js';
import type { RequestJournal } from './request-journal.js';
import type { ResourceReader } from './resource-reader.js';
import type { ServiceAuthoring } from './service-authoring.js';
import type { ServiceReads } from './service-reads.js';
import type { ServiceResources } from './service-resources.js';
import type { Result } from '../errors.js';
import type {
  Admission,
  ParsedSource,
  Request,
  ResourceRequest,
  Snapshot,
} from '../records/foreign.js';
import type { PresetPreparation } from '../records/service-answers.js';
import type { AssetBinding } from '../records/staged-resource.js';
import type { AdmitCommand, ChangeIntent } from '../records/command.js';
import type { RequestId } from '../brands.js';

/** The resource declarations of a DSL source, read by Language. Fails with `invalid-source`. */
export interface ResourceSyntax {
  requests(source: string): Result<readonly ResourceRequest[]>;
}

/** What a DSL change needs from Language: the source's resource declarations and its request. */
export interface ChangeInputs extends ResourceSyntax {
  /**
   * The Authoring request for `source` under `intent`'s preconditions against `snapshot`. Fails
   * with `invalid-source`, `invalid-input`, `invalid-response`, `not-found`, `already-exists`,
   * `revision-required` or `revision-conflict`.
   */
  request(
    intent: ChangeIntent,
    source: string,
    snapshot: Snapshot,
    id: RequestId,
  ): Result<Request>;
}

/** All the semantic adapter reads from a DSL source: a change's inputs and a profile parse. */
export interface SemanticInputs extends ChangeInputs {
  /** The parsed source, for `profile lint`. Fails with `invalid-source`. */
  profileParse(source: string): Result<ParsedSource>;
}

/** A preset file's Templates admission and the font or image declarations to stage first. */
export interface PresetSource {
  readonly admission: Admission;
  readonly resources: readonly ResourceRequest[];
}

/** A preset file's admission, and the Authoring request its Templates preparation sends. */
export interface PresetInputs {
  /**
   * The admission of `theme admit` or `recipe admit`. Fails with `invalid-theme`,
   * `duplicate-token` or `invalid-source`.
   */
  source(
    command: AdmitCommand,
    source: string,
  ): Result<PresetSource>;
  /**
   * The Authoring request for a prepared preset. Fails with `invalid-response` (no workspace
   * metadata record, or the preparation cannot form a request).
   */
  request(
    preparation: PresetPreparation,
    snapshot: Snapshot,
    id: RequestId,
    assets: readonly AssetBinding[],
  ): Result<Request>;
}

/**
 * Everything a service command may use; compose binds each member once. Each flow declares the
 * narrow part it reads (for example `AdmitDependencies`).
 */
export interface CliDependencies {
  readonly reads: ServiceReads;
  readonly authoring: ServiceAuthoring;
  readonly resources: ServiceResources;
  readonly files: LocalFiles;
  readonly journal: RequestJournal;
  readonly reader: ResourceReader;
  readonly collections: CollectionReader;
  readonly presets: PresetInputs;
  readonly semantic: ChangeInputs;
  nextRequestId(): RequestId;
}
