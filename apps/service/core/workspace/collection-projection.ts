/*
 * Projects one Model collection into the input Library validates and searches: descriptions,
 * sections and where each object is visible. Pure and total; Library checks the result and owns
 * any rejection. Shared with apps/web through the public index.
 */
import type { Collection } from '../../contract/records/capabilities.js';

/**
 * Builds the Library projection input for one collection. An object's description is its text
 * blocks joined by newlines; `visibleIn` lists the sections that show it. Never fails.
 */
export function projectCollection(collection: Collection): unknown {
  return {
    id: collection.id,
    revision: collection.revision,
    title: collection.title,
    description: collection.description ?? '',
    sections: collection.sections.map((section) => ({ id: section.id, title: section.title })),
    objects: collection.objects.map((object) => ({
      id: object.id,
      label: object.label,
      description: object.content
        .filter((block) => block.kind === 'text')
        .map((block) => block.text)
        .join('\n'),
      visibleIn: collection.sections
        .filter((section) => visible(collection, section.id, object.id))
        .map((section) => section.id),
    })),
  };
}

/** True when the section shows the object as an appearance or as a group that represents it. */
function visible(
  collection: Collection,
  sectionId: string,
  objectId: string,
): boolean {
  const section = collection.sections.find((section) => section.id === sectionId);
  if (!section) return false;
  return (
    section.appearances.some((item) => item.object === objectId) ||
    section.groups.some((item) => item.represents === objectId)
  );
}
