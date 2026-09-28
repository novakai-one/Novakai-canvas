/*
 * The records handed between the expand stages: preparation captures the dragged node and its
 * parent chain, geometry walks the ancestors computing growth, materialization writes the new
 * sizes into the section, and inspection checks the native preview against them. Pure types;
 * the rules live with each stage.
 */
import type { Change, PlacementIntent, Section } from '../../../contract/records/owners.js';
import type { GeometryChange } from '../../../contract/records/movement.js';
import type { Box } from '../capture/boxes.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import type { PlacementEntry } from '../movement-intent/types.js';

/** One placement entry of an expansion intent. */
export type ExpansionEntry = PlacementEntry;

/** An expansion entry whose target is a node. */
export type NodeExpansionEntry = ExpansionEntry & {
  readonly target: Extract<ExpansionEntry['target'], { readonly kind: 'node' }>;
};

/** One group record of a section. */
export type SectionGroup = Section['groups'][number];

/** The captured expansion target: intent, scene, node, parent and the requested delta. */
export type ExpansionPreparation = {
  readonly intent: PlacementIntent;
  readonly entry: NodeExpansionEntry;
  readonly sceneSection: SceneSection;
  readonly node: SceneNode;
  readonly parent: SceneNode | undefined;
  readonly before: Box;
  readonly dx: number;
  readonly dy: number;
};

/** A group grown to hold the drop: its model id, scene node and new size. */
export type ExpandedGroup = {
  readonly id: string;
  readonly node: SceneNode;
  readonly width: number;
  readonly height: number;
};

/** One ancestor's growth step: the grown group, the new requirement and the next ancestor. */
export type AncestorGrowth = {
  readonly requiredRight: number;
  readonly requiredBottom: number;
  readonly group: ExpandedGroup | undefined;
  readonly parent: SceneNode | undefined;
};

/** The growth an expansion needs: every grown group and the section's new size. */
export type ExpansionGeometry = {
  readonly expanded: ReadonlyMap<string, ExpandedGroup>;
  readonly requiredRight: number;
  readonly requiredBottom: number;
  readonly sectionWidth: number;
  readonly sectionHeight: number;
};

/** A section list with the expansion written in, and the changes that implies. */
export type MaterializedExpansion = {
  readonly sections: readonly Section[];
  readonly changes: readonly Change[];
};

/** One expected box checked against the preview: valid, with its movement when it moved. */
export type ExpansionInspection = {
  readonly valid: boolean;
  readonly change: GeometryChange | null;
};
