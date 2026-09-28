import type { AddGroupDraft } from '../../contract/records/creation.js';
import type { Change, Section } from '../../contract/records/owners.js';

export function groupDraftProblem(
  draft: AddGroupDraft,
  section: Section,
): string | null {
  if (draft.title.trim().length === 0) return 'Give the group a name before adding it.';
  return placementProblem(draft, section);
}

function placementProblem(
  draft: AddGroupDraft,
  section: Section,
): string | null {
  if (!draft.findRoom) return null;
  return section.placement?.locked ? 'Unlock the diagram before allowing it to move.' : null;
}

/** Release section placement and custom size: the replacement restores every child placement and wire route. */
export function groupCreationChanges(
  section: Section,
  findRoom: boolean,
): readonly Change[] {
  if (!findRoom) return [{ op: 'replace', target: 'sections', value: section }];
  const unplaced = { ...section };
  delete unplaced.placement;
  return [
    { op: 'reset-layout', section: section.id },
    { op: 'replace', target: 'sections', value: unplaced },
  ];
}
