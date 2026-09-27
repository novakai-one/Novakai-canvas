/*
 * The portable bundle: a JSON file holding one revision's complete DSL source, its manual
 * snapshot, their digests and every resource as base64. Also the inspection and import records
 * built from a bundle. Export grants no resource admission; the resource owners check
 * resources, and the host admits them later through Authoring.
 *
 * The private schemas below are declared before `bundleSchema` because it is built from them.
 * The exported schemas are shared, unfrozen objects; their `parse` throws a `ZodError`.
 */
import { z } from 'zod';
import { digest, identity } from '../brands.js';
import { manualSchema } from './manual.js';
import { resourceKind } from './resource.js';
import type { Resource } from './resource.js';
import type { Identity, Collection } from './artifact.js';
import type { Diagnostic } from '../errors.js';

/**
 * A resource as stored in the bundle file. `base64` is limited to 28 Mi characters (string
 * length); the schema does not check that it is valid base64, which decoding does later.
 */
const resource = z.strictObject({
  /** Which owner checks it. */
  kind: resourceKind,
  /** SHA-256 of the decoded bytes, 64 lowercase hex characters. */
  digest,
  /** The blob's media type, 1–120 characters. */
  mediaType: z.string().min(1).max(120),
  /** The blob's bytes as base64 text. */
  base64: z.string().max(28 * 1024 * 1024),
  /** The owner's metadata, any JSON record. */
  metadata: z.record(z.string(), z.json()),
});

/** The source revision's identity as stored in the bundle file. */
const sourceIdentity = z.strictObject({
  /** The source collection's ID. */
  collectionId: identity,
  /** The source revision. */
  revision: z.number().int().nonnegative(),
  /** The source projection's input key. */
  inputKey: z.string().min(1),
  /** The collection title. */
  title: z.string(),
});

/**
 * A whole bundle file: format `novakai.canvas.bundle`, `schemaVersion` 1, the source identity,
 * the DSL `source` with its `sourceDigest`, the `manual` snapshot with its `manualDigest`, and
 * at most 2,000 resources. Extra fields are rejected. The schema limits `source` to 16 Mi
 * characters (string length); inspection later limits its UTF-8 bytes to 16 MiB. The schema
 * checks shape only; inspection then checks both digests and every resource. The parsed bundle
 * and its nested `manual` record are frozen at their top level; other nested values are not.
 */
export const bundleSchema = z
  .strictObject({
    /** Always `novakai.canvas.bundle`. */
    format: z.literal('novakai.canvas.bundle'),
    /** Bundle file version; always 1. */
    schemaVersion: z.literal(1),
    /** The source revision's identity. */
    identity: sourceIdentity,
    /** The DSL source text. */
    source: z.string().max(16 * 1024 * 1024),
    /** SHA-256 of the source's UTF-8 bytes. */
    sourceDigest: digest,
    /** The manual snapshot (stored human layout decisions). */
    manual: manualSchema,
    /** SHA-256 of the manual snapshot's canonical JSON, as UTF-8 bytes. */
    manualDigest: digest,
    /** Every resource the revision needs, with bytes as base64. */
    resources: z.array(resource).max(2000),
  })
  .readonly();

/** A parsed bundle file. */
export type Bundle = z.infer<typeof bundleSchema>;

/** What `inspectBundle` found in a bundle whose digests and resources all checked out. */
export interface BundleInspection {
  /** The source revision's identity, as stored in the bundle. */
  readonly identity: Identity;

  /**
   * The DSL source text as carried by the bundle. Inspection checks its digest, not that it is
   * valid DSL; import preparation parses it.
   */
  readonly source: string;

  /** SHA-256 of the source's UTF-8 bytes (64 lowercase hex characters). */
  readonly sourceDigest: string;

  /** The manual snapshot (stored human layout decisions). */
  readonly manual: z.infer<typeof manualSchema>;

  /** The decoded resources, as the resource owners admitted them. */
  readonly resources: readonly Resource[];

  /** How many resources and manual-snapshot sections the bundle holds. */
  readonly counts: {
    /** Number of admitted resources. */
    readonly resources: number;
    /** Number of sections in the manual snapshot. */
    readonly sections: number;
  };
}

/**
 * An import request: the bundle `bytes` (a `Uint8Array`) and the new collection ID to import
 * into. Extra fields are rejected. A malformed request fails with `invalid-input`.
 */
export const importSchema = z.strictObject({
  /** The bundle file's bytes. */
  bytes: z.instanceof(Uint8Array),
  /** The new collection ID; must differ from the bundle's own collection ID. */
  targetCollectionId: identity,
});

/** A parsed import request. */
export type ImportRequest = z.infer<typeof importSchema>;

/**
 * An import ready for the host to admit through Authoring. Nothing has been written. The
 * collection has been re-validated under its new ID with revision 0.
 */
export interface PreparedImport {
  /** The bundle's source identity. */
  readonly original: Identity;

  /** The source identity with the new collection ID and revision 0. */
  readonly target: Identity;

  /** The rebuilt, validated collection under the new ID. */
  readonly collection: Collection;

  /**
   * The bundle's resources, as the owners admitted them. They include every theme and asset the
   * collection pins (`resource-rejected` otherwise).
   */
  readonly resources: readonly Resource[];

  /**
   * Always `absent`: the target collection must not exist yet. The host (Authoring) checks
   * this when admitting.
   */
  readonly expected: 'absent';

  /** The bundle's source digest. */
  readonly sourceDigest: string;

  /** Non-fatal problems; currently always empty. */
  readonly warnings: readonly Diagnostic[];
}
