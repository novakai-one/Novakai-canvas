import type { Collection, Section } from '../../contract/ports/model.js';
import type { ManualTarget } from '../../contract/records/requests.js';
/** Name human overrides for readers without asking agents to author their numeric coordinates. */
export function manualSummary(collection: Collection): readonly ManualTarget[] {
  return collection.sections.flatMap(sectionSummary);
}
/** Every manually positioned scope is distinguished from a manually routed wire. */
function sectionSummary(section: Section): readonly ManualTarget[] {
  const own = placementSummary(`section:@${section.id}`, section.placement);
  const nodes = section.appearances.flatMap((item) =>
    placementSummary(`@${section.id}/@${item.object}`, item.placement),
  );
  const groups = section.groups.flatMap((item) =>
    placementSummary(`@${section.id}/group:@${item.id}`, item.placement),
  );
  return [
    ...own,
    ...nodes,
    ...groups,
    ...section.wires.flatMap((wire) => wireSummary(section.id, wire)),
  ];
}
/** Presence is meaningful even for an unlocked soft preference. */
function placementSummary(
  target: string,
  placement: { readonly locked: boolean } | undefined,
): readonly ManualTarget[] {
  if (placement === undefined) return [];
  return [{ target, kind: 'placement', locked: placement.locked }];
}
/** A lock is visible even if malformed legacy input would omit manual points; Model validation runs first. */
function wireSummary(
  section: string,
  wire: Section['wires'][number],
): readonly ManualTarget[] {
  if (wire.manual === undefined && !wire.locked) return [];
  return [{ target: `@${section}/@${wire.relationship}`, kind: 'route', locked: wire.locked }];
}
