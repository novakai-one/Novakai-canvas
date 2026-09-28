/*
 * Connection vocabulary shared inside the connection pipeline: the gesture intent, the resolved
 * endpoint pairs the stages pass between themselves, and the injected policy port. Web core
 * imports no capability's runtime, so the caller (an adapter) reads Model's tables and injects
 * them here; Authoring owns admission, commit and recovery.
 */
import type {
  Collection,
  DiagramObject,
  EditIntent,
  Endpoint,
  Section,
} from '../../../contract/records/owners.js';
import type { MemberEndpointKind } from '../../../contract/records/owners.js';
import type {
  ConnectionEndpointView,
  RelationshipKind,
} from '../../../contract/records/connection.js';

/** A connection gesture's intent. */
export type ConnectionIntent = Extract<EditIntent, { kind: 'connection' }>;

/** Both gesture endpoints resolved to canonical addresses. */
export interface ResolvedEndpoints {
  readonly source: ConnectionEndpointView;
  readonly target: ConnectionEndpointView;
}

/** Both endpoints as Model addresses them. */
export interface RelationshipEndpoints {
  readonly source: Endpoint;
  readonly target: Endpoint;
}

/** A checked ID grammar: `safeParse` brands the value or reports failure. */
export interface IdGrammar<T> {
  readonly safeParse: (
    input: unknown,
  ) => { readonly success: true; readonly data: T } | { readonly success: false };
}

/** The object kinds a relationship kind accepts at one end; an absent entry allows any. */
export type EndpointKindTable = Readonly<
  Partial<Record<RelationshipKind, readonly DiagramObject['kind'][]>>
>;

/**
 * Model's connection policy and member-ID grammar. Web core imports no capability's runtime, so the
 * caller (an adapter) reads Model's tables and injects them here.
 */
export interface ConnectionPolicy {
  /** The relationship kinds each section mode allows; an absent mode allows `allKinds`. */
  readonly compatibleWires: Readonly<Partial<Record<Section['mode'], readonly RelationshipKind[]>>>;
  /** Every relationship kind, for section modes without a `compatibleWires` entry. */
  readonly allKinds: readonly RelationshipKind[];
  /** The member kinds each object kind exposes as endpoints, falling back to `generic`. */
  readonly memberEndpoints: Readonly<
    Partial<Record<DiagramObject['kind'], readonly MemberEndpointKind[]>>
  >;
  /** The member kinds addressable on an object kind with no `memberEndpoints` entry. */
  readonly genericMemberEndpoints: readonly MemberEndpointKind[];
  /** The source object kinds each relationship kind accepts; absent allows any. */
  readonly sourceEndpoints: EndpointKindTable;
  /** The target object kinds each relationship kind accepts; absent allows any. */
  readonly targetEndpoints: EndpointKindTable;
  /** Resolves a callable endpoint on the collection, when one exists. */
  readonly callable: (collection: Collection, endpoint: Endpoint) => unknown;
  /** Model's member-ID grammar. */
  readonly descendantId: IdGrammar<NonNullable<Endpoint['member']>>;
}
