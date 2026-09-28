/*
 * Proving a movement's selected targets can move together: no target twice, no section with one
 * of its nodes, no node with one of its ancestors, and every selected node present in the scene.
 * Pure; Authoring owns commit and recovery.
 */
import type {
  NodeTarget,
  PlacementIntent,
  RenderDocument,
  Target,
} from '../../../contract/records/owners.js';
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import { targetKey } from '../capture/boxes.js';
import type { SceneNode, SceneSection } from '../capture/scene.js';
import { mapResults } from '../results.js';
import type { CapturedNode, PlacementEntry } from './types.js';

/**
 * The intent's entries, returned unchanged and in order once they are proven movable together.
 *
 * A target selected twice is `invalid-edit`, checked across all entries first. Then the first
 * node entry that breaks a rule decides the refusal: its section also selected is
 * `invalid-edit`; the node missing from the scene is `stale-target`; an ancestor also selected
 * is `invalid-edit`; an ancestor missing from the scene is `stale-target`. An ancestor that is
 * both selected and missing counts as selected. Section, wire and sequence entries carry no
 * further rules.
 */
export function movableEntries(
  document: RenderDocument,
  intent: PlacementIntent,
): Result<readonly PlacementEntry[]> {
  const selected = selectedKeys(intent.entries);
  if (!selected.ok) return selected;
  const checked = mapResults(intent.entries, (entry) =>
    validateEntry(document, entry.target, selected.value),
  );
  if (!checked.ok) return checked;
  return { ok: true, value: [...intent.entries] };
}

/** The node target in the scene with its section; a missing section or node is `stale-target`. */
export function capturedNode(
  document: RenderDocument,
  target: NodeTarget,
): Result<CapturedNode> {
  const section = document.scene.sections.find((item) => item.id === target.section);
  const node = section?.nodes.find((item) => item.id === target.id);
  if (section === undefined || node === undefined)
    return failure('stale-target', 'The selected movement target is missing');
  return { ok: true, value: { section, node } };
}

/** Every selected target's key; a target selected twice is refused. */
function selectedKeys(entries: readonly PlacementEntry[]): Result<ReadonlySet<string>> {
  const keys = entries.map((entry) => targetKey(entry.target));
  const selected = new Set(keys);
  if (selected.size !== keys.length)
    return failure('invalid-edit', 'Movement contains duplicate selected targets');
  return { ok: true, value: selected };
}

/** Only node entries carry selection rules; every other target passes. */
function validateEntry(
  document: RenderDocument,
  target: Target,
  selected: ReadonlySet<string>,
): Result<void> {
  if (target.kind !== 'node') return { ok: true, value: undefined };
  return validateNodeEntry(document, target, selected);
}

/** The node's section is not selected, the node is in the scene, and its ancestors check out. */
function validateNodeEntry(
  document: RenderDocument,
  target: NodeTarget,
  selected: ReadonlySet<string>,
): Result<void> {
  if (selected.has(targetKey({ kind: 'section', id: target.section })))
    return failure('invalid-edit', 'Select either a section or one of its nodes, not both');
  const captured = capturedNode(document, target);
  if (!captured.ok) return captured;
  return validateAncestors(captured.value.section, captured.value.node.parent, selected);
}

/** Walks up from `parent` to the root. Layout rejects parent cycles, so the walk is bounded. */
function validateAncestors(
  section: SceneSection,
  parent: SceneNode['parent'],
  selected: ReadonlySet<string>,
): Result<void> {
  if (parent === null) return { ok: true, value: undefined };
  const next = validateAncestor(section, parent, selected);
  if (!next.ok) return next;
  return validateAncestors(section, next.value, selected);
}

/** One ancestor is neither selected nor missing; yields its own parent. Selected is checked first. */
function validateAncestor(
  section: SceneSection,
  id: SceneNode['id'],
  selected: ReadonlySet<string>,
): Result<SceneNode['parent']> {
  if (selected.has(targetKey({ kind: 'node', section: section.id, id })))
    return failure('invalid-edit', 'Select either an ancestor or its descendant, not both');
  const ancestor = section.nodes.find((item) => item.id === id);
  if (ancestor === undefined)
    return failure('stale-target', 'The selected movement parent is missing');
  return { ok: true, value: ancestor.parent };
}
