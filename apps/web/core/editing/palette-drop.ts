/*
 * What a palette drop onto the Canvas does: add a new object where it landed, refuse with a
 * reason, or nothing. The Canvas names the drop's diagram and group by text; they become Model IDs
 * only by matching the open collection's sections and groups. Pure; an add goes through the Add
 * path, which owns its request and recovery.
 */
import type { AddObjectDraft } from '../../contract/records/creation.js';
import type { DropTarget, Section } from '../../contract/records/owners.js';
import type { GroupId, SectionId } from '../../contract/brands.js';
import { diagnostic, type Diagnostic } from '../../contract/errors.js';
import { staleTarget } from './stale-target.js';

/** Object types the canvas palette offers. */
export const palette = [{ kind: 'module', label: 'Module' }] as const;

/** One palette entry. */
type PaletteItem = (typeof palette)[number];

/** What a palette drop should do: add an object, refuse with a reason, or nothing. */
export type PaletteDrop =
  | { readonly kind: 'add'; readonly draft: AddObjectDraft }
  | { readonly kind: 'refuse'; readonly problem: Diagnostic }
  | { readonly kind: 'ignore' };

/**
 * A palette drop creates a new object of that type in the group (or section) under the pointer.
 * A kind the palette does not offer is ignored. Refuses with `tree-section-drop` onto a tree, and
 * with `stale-target` when the diagram or group under the pointer is not in `sections`.
 */
export function planPaletteDrop(
  sections: readonly Section[],
  kind: string,
  target: DropTarget,
): PaletteDrop {
  const item = palette.find((entry) => entry.kind === kind);
  if (item === undefined) return { kind: 'ignore' };
  return dropInto(item, sections, target);
}

/** The drop onto the section under the pointer; refused as {@link planPaletteDrop} says. */
function dropInto(
  item: PaletteItem,
  sections: readonly Section[],
  target: DropTarget,
): PaletteDrop {
  const section = sections.find((entry) => entry.id === target.section);
  if (section === undefined) return refused(staleTarget(target.section, 'drop-again'));
  // Tree sections are outlines built from parent links; the Add forms exclude them too.
  if (section.mode === 'tree') return refused(treeRefusal(item.label, section.title));
  return addInto(item, section, target.group);
}

/** The add into the section, in the group under the pointer when there is one. */
function addInto(
  item: PaletteItem,
  section: Section,
  group: DropTarget['group'],
): PaletteDrop {
  if (group === null) return added(item, section.id, null);
  const found = section.groups.find((entry) => entry.id === group);
  if (found === undefined) return refused(staleTarget(group, 'drop-again'));
  return added(item, section.id, found.id);
}

/** A new object of the palette's type, named after it, in the section and group given. */
function added(
  item: PaletteItem,
  section: SectionId,
  group: GroupId | null,
): PaletteDrop {
  const label = `New ${item.label.toLowerCase()}`;
  return { kind: 'add', draft: { section, group, kind: item.kind, label, reuseObject: null } };
}

/** A refused drop, with the reason shown to the person. */
function refused(problem: Diagnostic): PaletteDrop {
  return { kind: 'refuse', problem };
}

/** `tree-section-drop`: a tree outline takes no palette drops. */
function treeRefusal(
  label: string,
  title: string,
): Diagnostic {
  return diagnostic(
    'tree-section-drop',
    `${label}s can't be dropped into a tree. Drop it into a diagram section instead.`,
    `"${title}" is a tree outline. Nothing was changed.`,
  );
}
