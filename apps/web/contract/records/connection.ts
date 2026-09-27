import type { RelationshipKind } from '@novakai/canvas-model';
import type { Collection, Section, Snapshot } from './owners.js';
import type { TransportGeneration } from '../brands.js';

export type { RelationshipKind };

export interface ConnectionEndpointView {
  readonly object: Collection['objects'][number]['id'];
  readonly kind: Collection['objects'][number]['kind'];
  readonly label: string;
  readonly member?: string;
  readonly memberLabel?: string;
}

export interface ConnectionDraft {
  readonly id: string;
  readonly base: Snapshot;
  readonly generation: TransportGeneration;
  readonly collection: Collection;
  readonly section: Section;
  readonly source: ConnectionEndpointView;
  readonly target: ConnectionEndpointView;
  readonly kinds: readonly RelationshipKind[];
  readonly kind: RelationshipKind;
  readonly label: string;
  readonly from: Cardinality;
  readonly to: Cardinality;
  readonly problem: string | null;
  readonly requestState: 'draft' | 'sending' | 'uncertain' | 'retryable' | 'rejected';
}

export type Cardinality = 'none' | '0..1' | '1' | '0..many' | '1..many';

export type ConnectionEdit =
  | { readonly kind: 'label'; readonly value: string }
  | { readonly kind: 'relationship-kind'; readonly value: RelationshipKind }
  | { readonly kind: 'cardinality'; readonly side: 'from' | 'to'; readonly value: Cardinality };
