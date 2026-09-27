import type { Collection } from '../../contract/records/capabilities.js';
/** Search projections contain only canonical descriptions and visibility; Library checks its own inventory vocabulary. */
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
/** Ordinary appearances and represented groups both expose canonical objects to discovery. */
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
