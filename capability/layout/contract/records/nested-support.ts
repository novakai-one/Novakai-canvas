import type { NestedSceneSpec } from './nested-scene-spec.js';
import type { NestedSupportFailure } from './nested-support-failure.js';
import type { PrototypeRoad } from './road-prototype.js';
import type { RoadPrototypeScene } from './road-scene.js';

/** A read-only query against a built reservation; callers reconstruct inputs to retry. */
export interface NestedSupportRequest {
  readonly spec: NestedSceneSpec;
  readonly scene: RoadPrototypeScene;
  readonly sectionInPortsLeft?: boolean;
}

/** Construction origins are semantic ordinals, never coordinates parsed from public IDs. */
export interface NestedSupportPopulation {
  readonly key: string;
  readonly roadId: string;
  readonly owner: string | null;
  readonly axis: PrototypeRoad['axis'];
  readonly origins: readonly string[];
  readonly demand: number;
  readonly width: number;
}

/** Each allocated visit retains its source-segment ordinal and directional rank. */
export interface NestedSupportTravel {
  readonly key: string;
  readonly roadKey: string;
  readonly wireId: string;
  readonly first: number;
  readonly last: number;
  readonly direction: 1 | -1;
  readonly rank: number;
  readonly count: number;
}

/** Each construction pair appears once, with both logical road identities. */
export interface NestedSupportContact {
  readonly key: string;
  readonly a: string;
  readonly b: string;
}

/** One scalar construction line; fixed body dimensions are offsets on one center. */
export interface NestedSupportVertex {
  readonly key: string;
  readonly axis: 'x' | 'y';
  readonly position: number;
  readonly aliases: readonly string[];
  readonly aliasOffsets?: Readonly<Record<string, number>>;
}

/** v >= u + required. Deficits describe current reservation, not moved geometry. */
export interface NestedSupportConstraint {
  readonly key: string;
  readonly kind: 'structure' | 'envelope' | 'body-fan' | 'gate-normal' | 'gate-tangent' | 'travel';
  readonly from: string;
  readonly to: string;
  readonly required: number;
  readonly available: number;
  readonly deficit: number;
  readonly provenance: readonly string[];
}

/** A nominal deficit may already have a supported orthogonal resolution in the old projector. */
export interface NestedSupportAdjustment {
  readonly wireId: string;
  readonly first: number;
  readonly nominalAnchor: number;
  readonly requiredAnchor: number;
  readonly deficit: number;
  readonly resolutionTemplate:
    'supported-orthogonal-forward-stem' | 'unsupported-retained-adjustment';
  readonly byteIdentityConsequence:
    'current-adjusted-geometry-preserved' | 'cannot-admit-current-adjustment';
}

/** Tangential fit is independent of the normal-approach constraints named here. */
export interface NestedSupportGate {
  readonly portId: string;
  readonly preferred: number;
  readonly interval: readonly [number, number];
  readonly normalConstraints: readonly string[];
}

/** Retained fan/turn footprints; coordinates are evidence only, never emitted geometry. */
export interface NestedSupportFootprint {
  readonly key: string;
  readonly kind: 'source-fan' | 'target-fan' | 'turn';
  readonly roadKeys: readonly string[];
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

/** Forced zero-separation cycle, preserving the pre-collapse members and producing constraints. */
export interface NestedSupportEquality {
  readonly members: readonly NestedSupportVertex[];
  readonly constraints: readonly string[];
  readonly provenance: readonly string[];
  readonly representative: string;
  readonly position: number;
}

/** Grow-only support reach beyond a retained road's nominal bounds. */
export interface NestedSupportSpanGrowth {
  readonly roadId: string;
  readonly axis: 'x' | 'y';
  readonly negative: number;
  readonly positive: number;
  readonly provenance: readonly string[];
}

/** Admission certifies computable constraints only. It does not certify scene legality. */
export interface NestedSupportLedger {
  readonly status: 'admitted-with-reservation-evidence';
  readonly spanGrowth?: readonly NestedSupportSpanGrowth[];
  readonly equalities: readonly NestedSupportEquality[];
  readonly populations: readonly NestedSupportPopulation[];
  readonly travels: readonly NestedSupportTravel[];
  readonly contacts: readonly NestedSupportContact[];
  readonly vertices: readonly NestedSupportVertex[];
  readonly constraints: readonly NestedSupportConstraint[];
  readonly order: readonly string[];
  readonly adjustments: readonly NestedSupportAdjustment[];
  readonly gates: readonly NestedSupportGate[];
  readonly footprints: readonly NestedSupportFootprint[];
  readonly envelopeSpills: readonly string[];
  readonly counts: {
    readonly T: number;
    readonly C: number;
    readonly G: number;
    readonly V: number;
    readonly E: number;
  };
}

/** Query success means graph admission only; failures never publish partial ledgers. */
export type NestedSupportResult =
  | { readonly ok: true; readonly value: NestedSupportLedger }
  | { readonly ok: false; readonly error: NestedSupportFailure };

/** Active embedding candidate, with replayable constraints and explicit anchor/identity movement. */
export type NestedEmbeddingResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly scene: RoadPrototypeScene;
        readonly ledger: NestedSupportLedger;
        readonly moved: readonly {
          readonly key: string;
          readonly before: number;
          readonly position: number;
        }[];
        readonly roadIds: readonly { readonly before: string; readonly after: string }[];
      };
    }
  | { readonly ok: false; readonly error: NestedSupportFailure };
