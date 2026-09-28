/*
 * Preparing a rearrangement: the intent must be one position-only module node, and its section,
 * scene and selected node are captured with the node's ancestor chain. Pure; every rejection
 * names its condition.
 */
import type { PlacementIntent } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type { MovementPreviewContext } from '../../../contract/records/movement.js';
import { failure } from '../../../contract/errors.js';
import { sameStamp } from '../movement-intent/admission.js';
import { movableEntries } from '../movement-intent/selection.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import type {
  NodeRearrangementEntry,
  RearrangementEntry,
  RearrangementPreparation,
} from './types.js';

/** Validate the intent and capture its target, or name why rearrangement cannot run. */
export function prepareRearrangement(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<RearrangementPreparation> {
  const availability = validateRearrangementAvailability(intent, context);
  return availability.ok ? resolveRearrangementTarget(intent, context) : availability;
}

/** The diagram must not have moved under the gesture, and a native preview must exist. */
function validateRearrangementAvailability(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<void> {
  if (!sameStamp(intent, context.stamp))
    return failure('stale-gesture', 'The diagram changed while rearrangement was being evaluated');
  if (context.preview === undefined)
    return failure('invalid-edit', 'Movement preview is not available');
  return validateRearrangementShape(intent);
}

/** Rearrangement is one node, position only: resized or multi-node intents are refused. */
function validateRearrangementShape(intent: PlacementIntent): Result<void> {
  return intent.entries.length !== 1 ||
    intent.entries.some(
      (entry) =>
        entry.target.kind !== 'node' ||
        entry.placement.width !== undefined ||
        entry.placement.height !== undefined,
    )
    ? failure('unsupported-edit', 'Rearrangement supports one position-only module node')
    : { ok: true, value: undefined };
}

/** Normalise the intent's entries against the document before capturing the target. */
function resolveRearrangementTarget(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<RearrangementPreparation> {
  const normalized = movableEntries(context.document, intent);
  return normalized.ok
    ? resolveNormalizedRearrangementTarget(intent, context, normalized.value)
    : normalized;
}

/** The single normalised entry must target a node. */
function resolveNormalizedRearrangementTarget(
  intent: PlacementIntent,
  context: MovementPreviewContext,
  entries: readonly RearrangementEntry[],
): Result<RearrangementPreparation> {
  const entry = entries[0];
  return entry === undefined || !isNodeRearrangementEntry(entry)
    ? failure('unsupported-edit', 'Rearrangement supports one selected node')
    : captureRearrangementTarget(intent, context, entry);
}

/** Narrow an entry to a node-targeted one. */
function isNodeRearrangementEntry(entry: RearrangementEntry): entry is NodeRearrangementEntry {
  return entry.target.kind === 'node';
}

/** Capture the section's projection, scene and source views plus the selected node's closure. */
function captureRearrangementTarget(
  intent: PlacementIntent,
  context: MovementPreviewContext,
  entry: NodeRearrangementEntry,
): Result<RearrangementPreparation> {
  const sectionId = entry.target.section;
  const projection = context.document.projection.sections.find(
    (section) => section.id === sectionId,
  );
  const scene = context.document.scene.sections.find((section) => section.id === sectionId);
  const source = context.document.collection.sections.find((section) => section.id === sectionId);
  const selected = scene?.nodes.find((node) => node.id === entry.target.id);
  if (projection?.mode !== 'modules')
    return failure('unsupported-edit', 'Rearrangement supports module sections only');
  if (scene === undefined || source === undefined || selected === undefined)
    return failure('stale-target', 'The rearrangement target is missing');
  return {
    ok: true,
    value: {
      intent: { ...intent, entries: [entry] },
      entry,
      sectionId,
      scene,
      source,
      selected,
      selectedGroupId: selected.measured.groupId,
      ancestors: ancestorIds(scene, selected),
    },
  };
}

/** The ids of every node above the selected one in the scene hierarchy. */
function ancestorIds(
  scene: SceneSection,
  selected: SceneNode,
): ReadonlySet<string> {
  const ancestors = new Set<string>();
  let parent = selected.parent;
  while (parent !== null) {
    ancestors.add(parent);
    parent = scene.nodes.find((node) => node.id === parent)?.parent ?? null;
  }
  return ancestors;
}
