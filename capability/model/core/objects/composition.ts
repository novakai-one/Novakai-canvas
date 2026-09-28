import type { Collection } from '../../contract/records/collection.js';
import type { DiagramObject } from '../../contract/records/object.js';
import type { Appearance, Section } from '../../contract/records/section.js';
import type { ContentBlock } from '../../contract/records/content.js';
import type { Diagnostic } from '../../contract/errors.js';
import { diagnoseWhen } from '../invariants/issues.js';
import { sectionPath } from '../sections/paths.js';

/**
 * Checks presentation intent: media-led compositions and group roles. Every failure is
 * collected, as `content` diagnostics, in this order:
 * 1. each object whose composition is not `stack` but has no image, icon or figure block, at
 *    `objects.<id>.composition`;
 * 2. each section appearance whose effective composition (its own, else the object's) is not
 *    `stack` but shows no media, at `sections.<section>.appearances.<object>.composition`. Only
 *    visible blocks count: none at `label` detail, the first block at `summary`, all at `full`.
 *    Appearances of missing objects are skipped (the section rules report those, as `reference`
 *    at `sections.<section>.appearances.<object>`);
 * 3. each section group whose role is not in `theme.roles`, at
 *    `sections.<section>.groups.<group>.role`, "Group role must be declared by the collection
 *    theme".
 * The media message is "Media-led composition requires a visible image, icon or figure; use
 * stack when hiding media".
 *
 * Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateComposition(collection: Collection): readonly Diagnostic[] {
  const objectIssues = collection.objects.flatMap(
    /** Checks one object's own composition against all its content. */
    (object) =>
      requireMedia(object.composition, object.content, `objects.${object.id}.composition`),
  );
  const appearanceIssues = collection.sections.flatMap(
    /** Checks every appearance in one section. */
    (section) =>
      section.appearances.flatMap(
        /** Checks one appearance's effective composition. */
        (appearance) => validateAppearance(appearance, section, collection),
      ),
  );
  const groupRoleIssues = collection.sections.flatMap(
    /** Checks the group roles in one section. */
    (section) => validateGroupRoles(section, collection),
  );
  return [...objectIssues, ...appearanceIssues, ...groupRoleIssues];
}

/**
 * Returns the blocks a view shows at a detail level: none at `label`, the first block at
 * `summary`, all of them at `full`.
 */
function visibleBlocks(
  object: DiagramObject,
  detail: Appearance['detail'],
): readonly ContentBlock[] {
  if (detail === 'label') {
    return [];
  }
  if (detail === 'summary') {
    return object.content.slice(0, 1);
  }
  return object.content;
}

/** Tells whether a block is media that can lead a composition: an image, icon or figure. */
function isMedia(block: ContentBlock): boolean {
  return block.kind === 'image' || block.kind === 'icon' || block.kind === 'figure';
}

/** Reports a composition other than `stack` that has no media among the given blocks. */
function requireMedia(
  composition: DiagramObject['composition'],
  blocks: readonly ContentBlock[],
  path: string,
): readonly Diagnostic[] {
  if (composition === 'stack') {
    return [];
  }
  return diagnoseWhen(
    !blocks.some(isMedia),
    'content',
    path,
    'Media-led composition requires a visible image, icon or figure; use stack when hiding media',
  );
}

/**
 * Checks one appearance: its own composition (else the object's) against the blocks visible at
 * its detail level. An appearance of a missing object is skipped.
 */
function validateAppearance(
  appearance: Appearance,
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  const object = collection.objects.find(
    /** Tells whether this is the appearing object. */
    (item) => item.id === appearance.object,
  );
  if (object === undefined) {
    return [];
  }
  return requireMedia(
    appearance.composition ?? object.composition,
    visibleBlocks(object, appearance.detail),
    `${sectionPath(section)}.appearances.${object.id}.composition`,
  );
}

/** Reports each group in a section whose role is not declared by the collection theme. */
function validateGroupRoles(
  section: Section,
  collection: Collection,
): readonly Diagnostic[] {
  return section.groups.flatMap(
    /** Checks one group's role. */
    (group) =>
      diagnoseWhen(
        !collection.theme.roles.includes(group.role),
        'content',
        `${sectionPath(section)}.groups.${group.id}.role`,
        'Group role must be declared by the collection theme',
      ),
  );
}
