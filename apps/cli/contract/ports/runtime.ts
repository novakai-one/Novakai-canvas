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

/** Language's reading of a DSL source, and the Authoring request a DSL change sends. */
export interface SemanticInputs extends ResourceSyntax {
  /** The parsed source. Fails with `invalid-source`. */
  profileParse(source: string): Result<ParsedSource>;
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

/** Narrow effects are bound once at CLI composition. */
export interface CliDependencies {
  readonly reads: ServiceReads;
  readonly authoring: ServiceAuthoring;
  readonly resources: ServiceResources;
  readonly files: LocalFiles;
  readonly journal: RequestJournal;
  readonly reader: ResourceReader;
  readonly collections: CollectionReader;
  readonly presets: PresetInputs;
  readonly semantic: SemanticInputs;
  nextRequestId(): RequestId;
}
