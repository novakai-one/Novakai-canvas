/*
 * The records handed between the rearrange stages: preparation captures the target, release lifts
 * placements out of the section, inspection checks the native reflow, and materialization writes
 * the accepted geometry back. Pure types; the rules live with each stage.
 */
import type { Change, PlacementIntent, Section } from '../../../contract/records/owners.js';
import type {
  GeometryChange,
  MoveOption,
  MovementPreviewContext,
} from '../../../contract/records/movement.js';
import type { Box } from '../capture/boxes.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import type { PlacementEntry } from '../movement-intent/types.js';

/** One placement entry of a rearrangement intent. */
export type RearrangementEntry = PlacementEntry;

/** A rearrangement entry whose target is a node. */
export type NodeRearrangementEntry = RearrangementEntry & {
  readonly target: Extract<RearrangementEntry['target'], { readonly kind: 'node' }>;
};

/** One group record of a section. */
export type SectionGroup = Section['groups'][number];

/** One appearance record of a section. */
export type SectionAppearance = Section['appearances'][number];

/** The captured rearrangement target: intent, the three section views and the selected node. */
export type RearrangementPreparation = {
  readonly intent: PlacementIntent;
  readonly entry: NodeRearrangementEntry;
  readonly sectionId: string;
  readonly scene: SceneSection;
  readonly source: Section;
  readonly selected: SceneNode;
  readonly selectedGroupId: string | null;
  readonly ancestors: ReadonlySet<string>;
};

/** A section list with placements released, and the changes that release implies. */
export type ReleasedCandidate = {
  readonly sections: readonly Section[];
  readonly changes: readonly Change[];
};

/** Everything the first native preview inspection needs. */
export type ReleasedInspection = {
  readonly prepared: RearrangementPreparation;
  readonly candidate: readonly Section[];
  readonly firstPreview: MoveOption['preview'];
  readonly firstMap: ReadonlyMap<string, Box>;
  readonly expected: ReadonlyMap<string, Box>;
  readonly closure: ReadonlySet<string>;
  readonly wanted: Box;
  readonly context: MovementPreviewContext;
};

/** A released inspection that produced geometry changes worth materializing. */
export type MaterializedCandidate = ReleasedInspection & {
  readonly geometryChanges: readonly GeometryChange[];
};

/** A materialized candidate whose replace changes were computed. */
export type MaterializedPreview = MaterializedCandidate & {
  readonly finalChanges: readonly Change[];
};
