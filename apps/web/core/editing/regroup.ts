import type {
  Appearance,
  RegroupIntent,
  RenderDocument,
  Section,
  Target,
} from '../../contract/records/owners.js';
import type { Result } from '../../contract/errors.js';
import { missing, nodeFor, sectionFor } from './targets.js';
import { pinnedFor } from './capture/pinning.js';
import { settled } from './capture/settling/sections.js';

/** Move one appearance into another group (or out of all groups), placed local to that group.
 * Everything else keeps its place, as in a plain move. */
export function regroupSections(
  intent: RegroupIntent,
  document: RenderDocument,
): Result<readonly Section[]> {
  const home = sectionFor(intent.target, document.collection.sections);
  const pinned = pinnedFor(document, new Set([home.id]));
  if (!pinned.ok) return pinned;
  const section = sectionFor(intent.target, pinned.value);
  const object = nodeFor(intent.target, document).measured.objectId;
  const current =
    section.appearances.find((item) => item.object === object) ?? missing(String(object));
  const placement = { ...current.placement, ...intent.placement };
  const moved = withGroup({ ...current, placement }, groupOf(intent.into, section, document));
  const changed = {
    ...section,
    appearances: section.appearances.map((item) => (item === current ? moved : item)),
  };
  const final = settled(changed, document, [intent.target]);
  return { ok: true, value: pinned.value.map((item) => (item.id === final.id ? final : item)) };
}

type GroupId = Section['groups'][number]['id'];

/** A section target means "no group"; a group node target names one of this section's groups. */
function groupOf(
  into: Target,
  section: Section,
  document: RenderDocument,
): GroupId | undefined {
  if (into.kind === 'section') return undefined;
  const id = nodeFor(into, document).measured.groupId;
  return section.groups.find((group) => group.id === id)?.id ?? missing(into.id);
}

/** A copy of the appearance in the group; no group leaves the `group` key out. */
function withGroup(
  appearance: Appearance,
  group: GroupId | undefined,
): Appearance {
  const { group: previousGroup, ...rest } = appearance;
  // The old group is replaced below; `void` marks the variable as deliberately unused.
  void previousGroup;
  return group === undefined ? rest : { ...rest, group };
}
