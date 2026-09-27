/*
 * Definition usages as the panel lists them. Model reports each use; this module finds the
 * canvas node that shows a field's object (the first match in scene order) and builds the select
 * event that moves the canvas selection to it. Other uses are listed by their collection path.
 */
import type {
  DefinitionUsage,
  DisplayOutcome,
  UsageItem,
  UsageOutcome,
  UsageSelection,
  UsageView,
} from '../../contract/records/definitions.js';
import type { NodeTarget, Scene } from '../../contract/records/owners.js';
import type { ObjectId } from '../../contract/brands.js';

/** The uses to list, each looked up on the canvas once; a Model failure lists none. */
export function usageView(
  outcome: UsageOutcome,
  scene: Scene,
): UsageView {
  if (!outcome.ok) return { count: 0, items: [] };
  return {
    count: outcome.value.length,
    items: outcome.value.map((usage) => usageItem(usage, scene)),
  };
}

/** Model's canonical text for a definition, or `Unavailable` when Model cannot show it. */
export function canonicalText(outcome: DisplayOutcome): string {
  return outcome.ok ? outcome.value : 'Unavailable';
}

/** The event that selects a usage's node in place of the current selection. */
export function usageSelection(target: NodeTarget): UsageSelection {
  return { kind: 'select', targets: [target], mode: 'replace' };
}

/** A field use carries the node that shows its object; any other use carries its path. */
function usageItem(
  usage: DefinitionUsage,
  scene: Scene,
): UsageItem {
  const key = `${usage.kind}:${usage.path}`;
  if (usage.kind !== 'field') return { kind: 'path', key, path: usage.path };
  return {
    kind: 'field',
    key,
    object: usage.object,
    field: usage.field,
    target: nodeTarget(scene, usage.object),
  };
}

/** The first node in scene order that shows the object; null when no node does. */
function nodeTarget(
  scene: Scene,
  objectId: ObjectId,
): NodeTarget | null {
  const found = scene.sections
    .flatMap((section) => section.nodes.map((node) => ({ section: section.id, node })))
    .find((item) => item.node.measured.objectId === objectId);
  if (found === undefined) return null;
  return { kind: 'node', section: found.section, id: found.node.id };
}
