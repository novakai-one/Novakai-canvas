/*
 * Projects one Model collection into the input Library validates and searches: descriptions,
 * sections and where each object is visible. Pure and total; Library checks the result and owns
 * any rejection. Shared with apps/web through the public index.
 */
import type { Collection } from '../../contract/records/capabilities.js';
import type {
  CollectionProjectionInput,
  ObjectProjectionInput,
  SectionProjectionInput,
} from '../../contract/records/workspace/contents.js';
import type { ObjectId } from '../../contract/brands.js';

/** One Model section. */
type ModelSection = Collection['sections'][number];

/** One Model object. */
type ModelObject = Collection['objects'][number];

/**
 * Builds the Library projection input for one collection: its identity, title and description
 * (empty text when it has none), each section's ID and title, and each object's projection (see
 * `projectObject`). Never fails.
 */
export function projectCollection(collection: Collection): CollectionProjectionInput {
  return {
    id: collection.id,
    revision: collection.revision,
    title: collection.title,
    description: collection.description ?? '',
    sections: collection.sections.map(projectSection),
    objects: collection.objects.map((object) => projectObject(object, collection.sections)),
  };
}

/** A section's ID and title. */
function projectSection(section: ModelSection): SectionProjectionInput {
  return { id: section.id, title: section.title };
}

/**
 * An object's ID and label, its text blocks joined by newlines as the description, and the
 * sections that show it (see `showsObject`).
 */
function projectObject(
  object: ModelObject,
  sections: readonly ModelSection[],
): ObjectProjectionInput {
  const showing = sections.filter((section) => showsObject(section, object.id));
  return {
    id: object.id,
    label: object.label,
    description: textDescription(object),
    visibleIn: showing.map((section) => section.id),
  };
}

/** The object's text blocks joined by newlines; empty text when it has none. */
function textDescription(object: ModelObject): string {
  const textBlocks = object.content.filter((block) => block.kind === 'text');
  return textBlocks.map((block) => block.text).join('\n');
}

/** Whether the section shows the object as an appearance or as a group that represents it. */
function showsObject(
  section: ModelSection,
  object: ObjectId,
): boolean {
  const appears = section.appearances.some((appearance) => appearance.object === object);
  const represented = section.groups.some((group) => group.represents === object);
  return appears || represented;
}
