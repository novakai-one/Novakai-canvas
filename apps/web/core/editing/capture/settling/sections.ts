/*
 * Settling a captured drag: the dropped node stops short of its siblings, groups grow to hold
 * children dropped past their edges, and only changed sections become replace changes. Pure;
 * Authoring owns commit and recovery.
 */
import type { Result } from '../../../../contract/errors.js';
import type {
  Change,
  PlacementIntent,
  RenderDocument,
  Section,
  Target,
} from '../../../../contract/records/owners.js';
import { placeEntries } from '../../placements.js';
import { pinnedSections } from '../pinning.js';
import { growToHold } from './grow.js';
import { stopShort } from './stop-short.js';

/** Every section after the intent: pinned, placed, then settled against the original scene. */
export function plannedSections(
  document: RenderDocument,
  intent: PlacementIntent,
): Result<readonly Section[]> {
  const frozen = pinnedSections(document, intent);
  if (!frozen.ok) {
    return frozen;
  }
  const pinnedDocument = {
    ...document,
    collection: { ...document.collection, sections: frozen.value },
  };
  const targets = intent.entries.map((entry) => entry.target);
  return {
    ok: true,
    value: placeEntries(intent, pinnedDocument).map((section) =>
      settled(section, document, targets),
    ),
  };
}

/** A dropped node stops short of siblings, and its group grows to hold it. */
export function settled(
  section: Section,
  document: RenderDocument,
  targets: readonly Target[],
): Section {
  if (section.mode !== 'modules') return section;
  return growToHold(stopShort(section, document, targets), document);
}

/** Only changed sections become replace changes; Model remains responsible for diagram validity. */
export function changes(
  document: RenderDocument,
  sections: readonly Section[],
): readonly Change[] {
  return sections
    .filter(
      (section) => document.collection.sections.find((item) => item.id === section.id) !== section,
    )
    .map((value) => ({ op: 'replace' as const, target: 'sections' as const, value }));
}
