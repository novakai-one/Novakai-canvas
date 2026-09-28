import type { EditIntent, Change, Section } from '../../contract/records/owners.js';
import type { EditContext } from '../../contract/records/editing.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { EditRejected } from './targets.js';
import { plannedSections } from './capture/settling/sections.js';
import { routeWire } from './routes.js';
import { regroupSections } from './regroup.js';
/** A gesture authored on another revision, layout input or display generation is kept as a draft instead of rebased silently. */
function current(
  intent: EditIntent,
  context: EditContext,
): boolean {
  return (
    intent.base.collectionId === context.stamp.collectionId &&
    intent.base.revision === context.stamp.revision &&
    intent.base.inputKey === context.stamp.inputKey &&
    intent.base.generation === context.stamp.generation
  );
}
/** Emit only changed section records; Model remains responsible for final diagram validity. */
function replacements(
  sections: readonly Section[],
  context: EditContext,
): readonly Change[] {
  return sections
    .filter(
      (section) =>
        context.document.collection.sections.find((item) => item.id === section.id) !== section,
    )
    .map((section) => ({ op: 'replace', target: 'sections', value: section }));
}
/** Each supported Canvas intent has an explicit semantic adapter; unsupported intents fail visibly rather than reporting success. */
function planned(
  intent: EditIntent,
  context: EditContext,
): Result<readonly Change[]> {
  const sections = plannedIntent(intent, context);
  if (sections === null)
    return failure('unsupported-edit', 'Use the inspector to complete this diagram edit');
  if (!sections.ok) return sections;
  return { ok: true, value: replacements(sections.value, context) };
}
/** Placement, regroup and route intents plan to sections; every other kind is unsupported here. */
function plannedIntent(
  intent: EditIntent,
  context: EditContext,
): Result<readonly Section[]> | null {
  switch (intent.kind) {
    case 'placement':
      return plannedSections(context.document, intent);
    case 'regroup':
      return regroupSections(intent, context.document);
    case 'route':
      return { ok: true, value: routeWire(intent, context.document) };
    default:
      return null;
  }
}
/** Plan a local human geometry edit atomically; Authoring owns persistence, feasibility and recovery after submission. */
export function planCanvasEdit(
  intent: EditIntent,
  context: EditContext,
): Result<readonly Change[]> {
  if (!current(intent, context))
    return failure('stale-gesture', 'The diagram changed while this gesture was being edited');
  return protectedPlan(intent, context);
}
/** No partial multi-target edit escapes on failure; the host preserves the original collection and recoverable draft. */
function protectedPlan(
  intent: EditIntent,
  context: EditContext,
): Result<readonly Change[]> {
  try {
    return planned(intent, context);
  } catch (error) {
    return rejected(error);
  }
}
/** Only a known edit rejection exposes its diagnostic; unexpected faults use a stable recovery outcome. */
function rejected(error: unknown): Result<never> {
  if (error instanceof EditRejected) return { ok: false, error: error.diagnostic };
  return failure('invalid-edit', 'The diagram edit could not be planned');
}
