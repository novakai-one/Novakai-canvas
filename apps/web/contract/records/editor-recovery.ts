import type { Snapshot, StoredRecord } from './owners.js';
import type { TransportGeneration } from '../brands.js';

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
  readonly collection: string;
  readonly edit: number;
}

export interface SourceRecoveryV1 {
  readonly kind: 'source-draft';
  readonly schemaVersion: 1;
  readonly base: CapturedCollectionBase;
  readonly collection: string;
  readonly source: string;
  readonly generation: TransportGeneration;
  readonly edit: number;
}

export interface ObjectRecoveryV1 {
  readonly kind: 'object-draft';
  readonly schemaVersion: 1;
  readonly base: CapturedCollectionBase;
  readonly key: string;
  readonly collection: string;
  readonly object: string;
  readonly generation: TransportGeneration;
  readonly edits: readonly unknown[];
}

export interface WireRecoveryV1 {
  readonly kind: 'wire-draft';
  readonly schemaVersion: 1;
  readonly base: CapturedCollectionBase;
  readonly key: string;
  readonly collection: string;
  readonly section: string;
  readonly relationship: string;
  readonly edits: readonly unknown[];
  readonly generation: TransportGeneration;
}
