import type {
  Change,
  EditIntent,
  PlacementIntent,
  RenderDocument,
  SceneStamp,
  Target,
} from './owners.js';
import type { Result } from '../errors.js';
import type { CollectionId } from '../brands.js';
import type { GeometryPreview } from '@novakai/canvas-canvas';
import type { Box } from '@novakai/canvas-layout';

export type MoveOptionKind = 'move-only' | 'expand' | 'rearrange';

export interface MovePolicy {
  readonly tolerance?: number;
  readonly allowExpansion?: boolean;
  readonly allowRearrangement?: boolean;
}

export interface GeometryChange {
  readonly target: Target;
  readonly before: Box;
  readonly after: Box;
}

export interface MoveOption {
  readonly id: string;
  readonly kind: MoveOptionKind;
  readonly label: 'Move only' | 'Expand container' | 'Rearrange section';
  readonly section?: string;
  readonly changes: readonly Change[];
  readonly geometryChanges: readonly GeometryChange[];
  readonly preview: GeometryPreview;
  readonly reason?: string;
}

export interface MoveReview {
  readonly id: string;
  readonly intent: PlacementIntent;
  readonly stamp: SceneStamp;
  readonly collectionId: CollectionId;
  readonly revision: number;
  readonly options: readonly MoveOption[];
  readonly selectedOption: string | null;
  readonly reason?: string;
}

export interface MovementPreviewContext {
  readonly document: RenderDocument;
  readonly stamp: SceneStamp;
  readonly preview?: (
    document: RenderDocument,
    intent: Extract<EditIntent, { kind: 'placement' }>,
    changes: readonly Change[],
  ) => Result<GeometryPreview | null>;
}
