/*
 * Admitting a movement intent to review: the gesture must be fresh, and every entry must be a
 * position-only move of a module section or one of its nodes. Pure; Authoring owns commit and
 * recovery.
 */
import type {
  PlacementIntent,
  RenderDocument,
  SceneStamp,
  Target,
} from '../../../contract/records/owners.js';
import type { MovementPreviewContext } from '../../../contract/records/movement.js';
import type { Result } from '../../../contract/errors.js';
import { failure } from '../../../contract/errors.js';
import type { SceneSection } from '../capture/scene.js';
import type { PlacementEntry } from './types.js';

/** The scene a movement is reviewed against: the rendered document and its stamp. */
type MoveContext = Pick<MovementPreviewContext, 'document' | 'stamp'>;

/** The intent was authored on the scene the stamp names. */
export function sameStamp(
  intent: PlacementIntent,
  stamp: SceneStamp,
): boolean {
  return sameStampValue(intent.base, stamp);
}

/** Two stamps name the same collection, revision, layout input and display generation. */
export function sameStampValue(
  a: SceneStamp,
  b: SceneStamp,
): boolean {
  return (
    a.collectionId === b.collectionId &&
    a.revision === b.revision &&
    a.inputKey === b.inputKey &&
    a.generation === b.generation
  );
}

/** An entry carries a size when width or height is set. */
export function hasSize(entry: PlacementEntry): boolean {
  return entry.placement.width !== undefined || entry.placement.height !== undefined;
}

/**
 * Whether the intent may be reviewed as a move at all. Refusals, first match wins:
 * `stale-gesture` — the intent was authored on a different scene than `context.stamp`;
 * `unsupported-edit` — an entry is not a section or node of a section projected as modules;
 * `unsupported-edit` — the intent has no entries, or an entry carries a width or height.
 */
export function validateMoveIntent(
  intent: PlacementIntent,
  context: MoveContext,
): Result<void> {
  if (!sameStamp(intent, context.stamp))
    return failure('stale-gesture', 'The diagram changed while this gesture was being edited');
  return validateMoveTargets(intent.entries, context.document);
}

/** Every entry targets a module section or node, then every entry moves without resizing. */
function validateMoveTargets(
  entries: readonly PlacementEntry[],
  document: RenderDocument,
): Result<void> {
  if (!entries.every((entry) => moduleTarget(document, entry.target)))
    return failure('unsupported-edit', 'Movement review supports module sections only');
  if (entries.length === 0 || entries.some(hasSize))
    return failure('unsupported-edit', 'Movement review supports position-only module moves');
  return { ok: true, value: undefined };
}

/** A section, or a node in a section, projected as modules; wires and sequences never are. */
function moduleTarget(
  document: RenderDocument,
  target: Target,
): boolean {
  if (target.kind === 'section') return modulesSection(document, target.id);
  if (target.kind === 'node') return modulesSection(document, target.section);
  return false;
}

/** Some projection of the section uses the modules mode. */
function modulesSection(
  document: RenderDocument,
  id: SceneSection['id'],
): boolean {
  return document.projection.sections.some(
    (section) => section.id === id && section.mode === 'modules',
  );
}
