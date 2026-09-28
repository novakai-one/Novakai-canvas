/*
 * The inputs and results of Library's entry points. Library writes nothing: a host that commits a
 * plan or pages results checks the read versions, and Authoring owns commit and crash recovery.
 */
import type { OrganisationId, CollectionId } from './brands.js';
import type { Organisation } from './records/organisation.js';

/** The input of `planOrganisation`. Every value is untrusted and checked by Library. */
export interface PlanInput {
  /** The original snapshot (see `LibrarySnapshot`). */
  readonly snapshot: unknown;
  /** The ordered batch of organisation changes (see `OrganisationChange`). */
  readonly changes: unknown;
}

/**
 * The input of `planMembership`: the same batch, checked against the collection inventory
 * Authoring is about to commit instead of the snapshot's own. Every value is untrusted.
 */
export interface MembershipInput extends PlanInput {
  /** The collection inventory Authoring is about to commit (see `CollectionProjection`). */
  readonly inventory: unknown;
}

/** The input of `queryLibrary`. Both values are untrusted and checked by Library. */
export interface QueryInput {
  /** The snapshot to search (see `LibrarySnapshot`). */
  readonly snapshot: unknown;
  /** The search criteria (see `QueryRequest`). */
  readonly request: unknown;
}

/** The organisation's ID and the revision read. */
export interface OrganisationVersion {
  readonly id: OrganisationId;
  readonly revision: number;
}

/** A collection's ID and the revision read. */
export interface CollectionVersion {
  readonly id: CollectionId;
  readonly revision: number;
}

/**
 * The source revisions an operation read: the organisation's, and each collection's, sorted by
 * collection ID. A host that commits a plan or pages results must make sure these sources have not
 * changed. (The current service host builds its commit conditions from its own snapshot instead
 * of reading this record.)
 */
export interface ReadVersions {
  readonly organisation: OrganisationVersion;
  /** Sorted by collection ID. */
  readonly collections: readonly CollectionVersion[];
}

/**
 * A proposed organisation, not yet stored. The host commits it only if the sources in `versions` are
 * unchanged; Authoring performs the commit.
 */
export interface OrganisationPlan {
  /** The organisation after the changes. Its `revision` is unchanged; Authoring assigns the next one. */
  readonly candidate: Organisation;
  /** The revisions of the original snapshot the plan was made from. */
  readonly versions: ReadVersions;
  /** True when the candidate differs from the original organisation (the net effect of all changes). */
  readonly changed: boolean;
}
