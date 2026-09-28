/*
 * Preparing an expansion: the intent must be one position-only module node, and its scene, node
 * and parent are captured with the requested delta resolved against the parent's origin. Pure;
 * every rejection names its condition.
 */
import type { PlacementIntent } from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import type { MovementPreviewContext } from '../../../contract/records/movement.js';
import { failure } from '../../../contract/errors.js';
import { sceneBox } from '../capture/boxes.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import { hasSize, sameStamp } from '../movement-intent/admission.js';
import { movableEntries } from '../movement-intent/selection.js';
import type { ExpansionEntry, ExpansionPreparation, NodeExpansionEntry } from './types.js';

/** Validate the intent and capture its target, or name why expansion cannot run. */
export function prepareExpansion(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<ExpansionPreparation> {
  const request = validateExpansionRequest(intent, context);
  return request.ok ? resolveExpansionTarget(intent, context) : request;
}

/** The gesture must be fresh, a preview must exist, and the shape must be supported. */
function validateExpansionRequest(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<void> {
  const available = validateExpansionAvailability(intent, context);
  return available.ok ? validateExpansionShape(intent) : available;
}

/** The diagram must not have moved under the gesture, and a native preview must exist. */
function validateExpansionAvailability(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<void> {
  if (!sameStamp(intent, context.stamp))
    return failure('stale-gesture', 'The diagram changed while expansion was being evaluated');
  if (context.preview === undefined)
    return failure('invalid-edit', 'Movement preview is not available');
  return { ok: true, value: undefined };
}

/** Expansion is one node, position only: resized or multi-node intents are refused. */
function validateExpansionShape(intent: PlacementIntent): Result<void> {
  return intent.entries.length !== 1 || intent.entries.some(hasSize)
    ? failure('unsupported-edit', 'Container expansion supports one position-only module move')
    : { ok: true, value: undefined };
}

/** Normalise the intent's entries against the document before capturing the target. */
function resolveExpansionTarget(
  intent: PlacementIntent,
  context: MovementPreviewContext,
): Result<ExpansionPreparation> {
  const normalized = movableEntries(context.document, intent);
  return normalized.ok
    ? resolveNormalizedExpansionTarget(intent, context, normalized.value)
    : normalized;
}

/** The single normalised entry must target a node. */
function resolveNormalizedExpansionTarget(
  intent: PlacementIntent,
  context: MovementPreviewContext,
  entries: readonly ExpansionEntry[],
): Result<ExpansionPreparation> {
  if (entries.length !== 1)
    return failure('unsupported-edit', 'Container expansion supports one selected node');
  const entry = entries[0];
  return entry === undefined || !isNodeExpansionEntry(entry)
    ? failure('unsupported-edit', 'Container expansion supports module nodes only')
    : captureExpansionTarget(intent, context, entry);
}

/** Narrow an entry to a node-targeted one. */
function isNodeExpansionEntry(entry: ExpansionEntry): entry is NodeExpansionEntry {
  return entry.target.kind === 'node';
}

/** Capture the section's scene view and the target node of a module section. */
function captureExpansionTarget(
  intent: PlacementIntent,
  context: MovementPreviewContext,
  entry: NodeExpansionEntry,
): Result<ExpansionPreparation> {
  const sectionId = entry.target.section;
  const sceneSection = context.document.scene.sections.find((item) => item.id === sectionId);
  const node = sceneSection?.nodes.find((item) => item.id === entry.target.id);
  const moduleSection = context.document.projection.sections.find((item) => item.id === sectionId);
  if (moduleSection?.mode !== 'modules')
    return failure('unsupported-edit', 'Container expansion supports module sections only');
  if (sceneSection === undefined || node === undefined)
    return failure('stale-target', 'The expansion target is missing');
  return captureExpansionGeometry(intent, context, entry, sceneSection, node);
}

/** Capture the parent and the requested delta from the node's current box. */
function captureExpansionGeometry(
  intent: PlacementIntent,
  context: MovementPreviewContext,
  entry: NodeExpansionEntry,
  sceneSection: SceneSection,
  node: SceneNode,
): Result<ExpansionPreparation> {
  const parent = expansionParent(sceneSection, node);
  if (!parent.ok) return parent;
  const before = sceneBox(context.document, entry.target);
  if (before === undefined) return failure('stale-target', 'The expansion geometry is missing');
  const parentX = sceneSection.origin.x + (parent.value?.box.x ?? 0);
  const parentY = sceneSection.origin.y + (parent.value?.box.y ?? 0);
  return {
    ok: true,
    value: {
      intent: { ...intent, entries: [entry] },
      entry,
      sceneSection,
      node,
      parent: parent.value,
      before,
      dx: parentX + entry.placement.x - before.x,
      dy: parentY + entry.placement.y - before.y,
    },
  };
}

/** The node's parent in the scene; a named parent that is missing is a stale target. */
function expansionParent(
  section: SceneSection,
  node: SceneNode,
): Result<SceneNode | undefined> {
  if (node.parent === null) return { ok: true, value: undefined };
  const parent = section.nodes.find((item) => item.id === node.parent);
  return parent === undefined
    ? failure('stale-target', 'The expansion parent is missing')
    : { ok: true, value: parent };
}
