import type { RouteIntent, Section, RenderDocument } from '../../contract/records/owners.js';
import { sectionFor, missing } from './targets.js';
/** Preserve is an interaction instruction, never a stored route value. */
function resolved<T>(
  next: T | 'preserve',
  previous: T,
): T {
  if (next === 'preserve') return previous;
  return next;
}
/** Labels and cardinality stay canonical; only this section's points, attachment sides and lock can change. */
function changedSection(
  intent: RouteIntent,
  document: RenderDocument,
): Section {
  const section = sectionFor(intent.target, document.collection.sections);
  const projection = document.projection.sections.find((item) => item.id === section.id);
  const visual = projection?.wires.find((item) => item.id === intent.target.id);
  if (!visual) return missing(intent.target.id);
  return replaceRoute(section, visual.relationshipId, intent);
}
/** Routed scene IDs are resolved through Presentation's explicit relationship identity, not string parsing. */
function replaceRoute(
  section: Section,
  relationship: string,
  intent: RouteIntent,
): Section {
  const current = section.wires.find((item) => item.relationship === relationship);
  if (!current) return missing(relationship);
  const changed = {
    ...current,
    manual: intent.route.points,
    sourceSide: resolved(intent.route.sourceSide, current.sourceSide),
    targetSide: resolved(intent.route.targetSide, current.targetSide),
    locked: resolved(intent.route.locked, current.locked),
  };
  return {
    ...section,
    wires: section.wires.map((item) => (item.relationship === relationship ? changed : item)),
  };
}
/** Route points are already section-local. This operation never rebases or recomputes authored bends. */
export function routeWire(
  intent: RouteIntent,
  document: RenderDocument,
): readonly Section[] {
  const changed = changedSection(intent, document);
  return document.collection.sections.map((item) => (item.id === changed.id ? changed : item));
}
