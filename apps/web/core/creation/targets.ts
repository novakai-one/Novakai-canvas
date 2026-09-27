/*
 * Where an add can go. Tree diagrams take no adds, so only the other sections are offered. A draft
 * section that is not offered falls back to the first offered section. An object already shown in
 * the target diagram cannot be reused there again. A select's text becomes an ID only by matching
 * a listed item. Pure; nothing to recover.
 */
import type { ReuseChoice } from '../../contract/records/creation.js';
import type { Collection, DiagramObject, Section } from '../../contract/records/owners.js';
import type { ObjectId, SectionId } from '../../contract/brands.js';

/** The diagrams an add can target: every section except trees; none without a collection. */
export function addableSections(collection: Collection | null): readonly Section[] {
  return (collection?.sections ?? []).filter((section) => section.mode !== 'tree');
}

/**
 * The draft's diagram when it is offered, else the first offered one, so the select and the
 * submit agree. Null when no diagram is offered.
 */
export function selectedSection(
  current: SectionId | null,
  sections: readonly Section[],
): Section | null {
  return sections.find((section) => section.id === current) ?? sections[0] ?? null;
}

/**
 * The ID of the listed item whose ID is `value`, a select's text. Null when no listed item has
 * it, so the empty "none" option gives null.
 */
export function listedId<Id extends string>(
  items: readonly { readonly id: Id }[],
  value: string,
): Id | null {
  return items.find((item) => item.id === value)?.id ?? null;
}

/** Objects that already appear in the target diagram cannot be reused there again. */
export function presentObjects(section: Section): ReadonlySet<ObjectId> {
  return new Set(section.appearances.map((appearance) => appearance.object));
}

/** Every object in the collection as a reuse choice; one already present is disabled. */
export function reuseChoices(
  objects: readonly DiagramObject[],
  present: ReadonlySet<ObjectId>,
): readonly ReuseChoice[] {
  return objects.map((item) => ({
    id: item.id,
    label: reuseLabel(item, present),
    disabled: present.has(item.id),
  }));
}

/** An object's name, marked when the target diagram already shows it. */
function reuseLabel(
  item: DiagramObject,
  present: ReadonlySet<ObjectId>,
): string {
  return present.has(item.id) ? `${item.label} · already in this diagram` : item.label;
}
