import type {
  PlacementIntent,
  Section,
  RenderDocument,
  Placement,
} from '../../contract/records/owners.js';
import { sectionFor, nodeFor, missing } from './targets.js';
import type { PlacementEntry } from './movement-intent/types.js';
type Entry = PlacementEntry;
/** Coordinates have already been converted by Canvas to immediate-parent local space. Applying another origin would corrupt nested drags. */
function place(
  entry: Entry,
  section: Section,
  document: RenderDocument,
): Section {
  if (entry.target.kind === 'section')
    return { ...section, placement: merged(entry.placement, section.placement) };
  const node = nodeFor(entry.target, document);
  if (node.measured.groupId !== null) return group(section, node.measured.groupId, entry.placement);
  return appearance(section, node.measured.objectId, entry.placement);
}
/** A move retains prior explicit dimensions; a resize supplies new dimensions in the same placement record. */
function merged(
  next: Placement,
  previous: Placement | undefined,
): Placement {
  return { ...previous, ...next };
}
/** Group movement updates only that local container; descendants keep their immediate-parent coordinates. */
function group(
  section: Section,
  id: string,
  placement: Placement,
): Section {
  const current = section.groups.find((item) => item.id === id);
  if (!current) return missing(id);
  const changed = { ...current, placement: merged(placement, current.placement) };
  return { ...section, groups: section.groups.map((item) => (item.id === id ? changed : item)) };
}
/** Shared object content is untouched; only the selected section's appearance receives a placement override. */
function appearance(
  section: Section,
  id: string | null,
  placement: Placement,
): Section {
  const current = section.appearances.find((item) => item.object === id);
  if (!current) return missing(String(id));
  const changed = { ...current, placement: merged(placement, current.placement) };
  return {
    ...section,
    appearances: section.appearances.map((item) => (item.object === id ? changed : item)),
  };
}
/** Multiple selected targets accumulate in one immutable section set, producing one Authoring history transaction. */
export function placeEntries(
  intent: PlacementIntent,
  document: RenderDocument,
): readonly Section[] {
  return intent.entries.reduce<readonly Section[]>((sections, entry) => {
    const section = sectionFor(entry.target, sections);
    const changed = place(entry, section, document);
    return sections.map((item) => (item.id === changed.id ? changed : item));
  }, document.collection.sections);
}
