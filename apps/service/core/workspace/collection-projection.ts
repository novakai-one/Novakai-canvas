/*
 * Why this file exists
 *
 * Library lists and searches collections, but it doesn't need a whole Model collection. It needs
 * a short summary: titles, text, and which sections show each object. For example, an object `api`
 * with the text "Handles requests", shown in section `overview`, becomes
 * `{ id: 'api', label: 'API', description: 'Handles requests', visibleIn: ['overview'] }`.
 *
 * This file makes that summary (Library calls it a `CollectionProjection`). The web app uses it
 * too, through contract/index.ts. It never checks the summary; Library does.
 */
import type {
  Collection,
  CollectionProjection,
  ObjectProjection,
  SectionProjection,
} from '../../contract/records/capability-types.js';
import type { ObjectId, SectionId } from '../../contract/brands.js';

/** One Model section. */
type ModelSection = Collection['sections'][number];

/** One Model object. */
type ModelObject = Collection['objects'][number];

/**
 * Turns one collection into the summary Library keeps for it. An object's description is its text
 * blocks joined by newlines; a collection with no description gets empty text. Never fails.
 */
export function projectCollection(collection: Collection): CollectionProjection {
  const description = collection.description ?? '';
  const sections = collection.sections.map(projectSection);
  const objects = collection.objects.map((object) => projectObject(object, collection.sections));
  return {
    id: collection.id,
    revision: collection.revision,
    title: collection.title,
    description,
    sections,
    objects,
  };
}

/** Keeps a section's ID and title. */
function projectSection(section: ModelSection): SectionProjection {
  return { id: section.id, title: section.title };
}

/** Keeps an object's ID and label, and adds its description and the sections that show it. */
function projectObject(
  object: ModelObject,
  sections: readonly ModelSection[],
): ObjectProjection {
  const description = textDescription(object);
  const visibleIn = sectionsShowing(object.id, sections);
  return { id: object.id, label: object.label, description, visibleIn };
}

/** Joins the object's text blocks with newlines; an object with none gets empty text. */
function textDescription(object: ModelObject): string {
  const textBlocks = object.content.filter((block) => block.kind === 'text');
  const texts = textBlocks.map((block) => block.text);
  return texts.join('\n');
}

/** Lists the IDs of the sections that show the object, in section order. */
function sectionsShowing(
  object: ObjectId,
  sections: readonly ModelSection[],
): readonly SectionId[] {
  const showing = sections.filter((section) => showsObject(section, object));
  return showing.map((section) => section.id);
}

/** Whether the section shows the object as an appearance, or as a group that represents it. */
function showsObject(
  section: ModelSection,
  object: ObjectId,
): boolean {
  const appears = section.appearances.some((appearance) => appearance.object === object);
  const represented = section.groups.some((group) => group.represents === object);
  return appears || represented;
}
