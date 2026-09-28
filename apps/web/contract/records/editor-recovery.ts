import type { Snapshot, StoredRecord } from './owners.js';
import type {
  CollectionId,
  ObjectDraftKey,
  ObjectId,
  RelationshipId,
  SectionId,
  SourceEdit,
  TransportGeneration,
  WireDraftKey,
} from '../brands.js';

/** A recovery base carries only the complete original collection record. */
export interface CapturedCollectionBase {
  readonly kind: 'captured-collection';
  readonly schemaVersion: 1;
  readonly workspace: Snapshot['workspace'];
  readonly sequence: Snapshot['sequence'];
  readonly record: StoredRecord;
}

/** Fresh diagrams remain full snapshots; retained editors use the compact alternative. */
export type EditingBase = Snapshot | CapturedCollectionBase;

/** A stored source draft after its reader checked it; the source editor resumes from it. */
export interface RecoveredSource {
  readonly source: string;
  readonly base: EditingBase;
  readonly generation: TransportGeneration;
  readonly collection: CollectionId;
  readonly edit: SourceEdit;
}

export interface SourceRecoveryV1 {
  readonly kind: 'source-draft';
  readonly schemaVersion: 1;
  readonly base: CapturedCollectionBase;
  readonly collection: CollectionId;
  readonly source: string;
  readonly generation: TransportGeneration;
  readonly edit: SourceEdit;
}

export interface ObjectRecoveryV1 {
  readonly kind: 'object-draft';
  readonly schemaVersion: 1;
  readonly base: CapturedCollectionBase;
  readonly key: ObjectDraftKey;
  readonly collection: CollectionId;
  readonly object: ObjectId;
  readonly generation: TransportGeneration;
  readonly edits: readonly unknown[];
}

export interface WireRecoveryV1 {
  readonly kind: 'wire-draft';
  readonly schemaVersion: 1;
  readonly base: CapturedCollectionBase;
  readonly key: WireDraftKey;
  readonly collection: CollectionId;
  readonly section: SectionId;
  readonly relationship: RelationshipId;
  readonly edits: readonly unknown[];
  readonly generation: TransportGeneration;
}
