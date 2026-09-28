/*
 * The Export service and the dependency sets its parts need. Each part asks only for the
 * collaborators it uses: producing an artifact, building a bundle, inspecting a bundle or
 * preparing an import.
 */
import type { Result } from './errors.js';
import type { Artifact } from './records/artifact.js';
import type { BundleInspection, PreparedImport } from './records/bundle.js';
import type { Cancellation } from './records/input.js';
import type { SnapshotReader } from './ports/snapshot.js';
import type { Documents } from './ports/documents.js';
import type { Resources } from './ports/resources.js';
import type { Encoding } from './ports/encoding.js';
import type { FormatRegistry } from './ports/formats.js';

/**
 * The Export service, built by `createExport`. HTTP downloads and headless agents use the same
 * three operations. None of them throws or rejects; every failure is a `Result`. Every operation
 * only reads, so a failed call is safe to retry; the host repairs providers and performs any
 * writes. Import is only prepared here; the host admits it through Authoring.
 */
export interface Export {
  /**
   * Exports one revision as SVG, PNG, PDF, HTML or a portable bundle.
   *
   * @param input - An unknown export request: `identity` (`collectionId`, `revision`) and
   * `format`, with optional `scope`, `scale`, `paper` and `orientation`.
   * @param signal - Optional cancellation, checked between stages.
   * @returns The finished artifact, or a failure. A malformed request fails before any revision
   * is acquired; a throw becomes `encoding-failed`.
   */
  exportArtifact(
    input: unknown,
    signal?: Cancellation,
  ): Promise<Result<Artifact>>;

  /**
   * Checks bundle bytes without admitting anything.
   *
   * @param bytes - Unknown input; must be a `Uint8Array` of at most 128 MiB.
   * @returns What the bundle contains, or a failure. A throw becomes `invalid-bundle`.
   */
  inspectBundle(bytes: unknown): Promise<Result<BundleInspection>>;

  /**
   * Prepares a bundle as a new collection, ready for the host to admit through Authoring.
   * Nothing is committed.
   *
   * @param input - An unknown import request (`bytes` and `targetCollectionId`).
   * @returns The prepared import, or a failure. A throw becomes `invalid-import`.
   */
  prepareImport(input: unknown): Promise<Result<PreparedImport>>;
}

/** What building, inspecting and importing bundles need. */
export interface TransferDependencies {
  /** Validates, prints and parses collections. */
  readonly documents: Documents;

  /** The resource owners' check of transferred resources. */
  readonly resources: Resources;

  /** Byte and text codecs, and hashing. */
  readonly encoding: Encoding;
}

/** What producing an artifact needs. */
export interface ProductionDependencies {
  /** Leases the requested revision. */
  readonly snapshots: SnapshotReader;

  /** One encoder per format. */
  readonly formats: FormatRegistry;

  /** Hashes the finished bytes into the artifact digest. */
  readonly encoding: Pick<Encoding, 'hash'>;
}

/** Everything the Export service needs: the transfer set plus snapshots and format handlers. */
export interface Dependencies extends TransferDependencies {
  /** Leases the requested revision. */
  readonly snapshots: SnapshotReader;

  /** One encoder per format. */
  readonly formats: FormatRegistry;
}

/** What preparing an import needs. It reads and parses collections but never prints them. */
export interface ImportDependencies extends Omit<TransferDependencies, 'documents'> {
  /** Validates and parses collections. */
  readonly documents: Pick<Documents, 'read' | 'parse'>;
}

/** What inspecting a bundle needs. It never reads, prints or parses a collection. */
export type InspectionDependencies = Pick<TransferDependencies, 'resources' | 'encoding'>;
