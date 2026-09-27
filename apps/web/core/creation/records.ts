/*
 * The Model changes an add sends, and the Add-form checks before them. A diagram needs an open
 * collection and a name. An object or group needs an existing diagram in the open collection, or in
 * the collection its capture was made on. A new object needs a name, a reused one must exist and
 * must not already be in the diagram, and a chosen group must be a Model group ID. A group needs
 * a name, and an unlocked diagram when it may move to fit. Pure; the session captures, mints IDs
 * and sends.
 */
import { diagnostic, type Result } from '../../contract/errors.js';
import type {
  AddDiagramDraft,
  AddGroupDraft,
  AddObjectDraft,
} from '../../contract/records/creation.js';
import type {
  Appearance,
  Change,
  DiagramObject,
  Group,
  Section,
  Snapshot,
} from '../../contract/records/owners.js';
import type { ActiveDiagram } from '../../contract/records/workspace.js';
import type { IdGrammar } from '../editing/connection/types.js';
import { groupCreationChanges, groupDraftProblem } from '../editing/group-creation.js';
import { capturedElsewhere, type CreationCapture } from './captures.js';

/** Where an object or group is added: the diagram to add to, as captured. */
export interface CreationContext {
  readonly active: ActiveDiagram;
  readonly section: Section;
}

/** The open diagram a new diagram is added to, once the form names it. */
export function diagramTarget(
  active: ActiveDiagram | null,
  snapshot: Snapshot | null,
  draft: AddDiagramDraft,
): Result<ActiveDiagram> {
  if (active === null || snapshot === null) return creationFailure('Open a collection first.');
  return namedDiagram(active, draft);
}

/** The capture, while it belongs to the open collection. */
export function capturedIn<Id>(
  capture: CreationCapture<Id>,
  active: ActiveDiagram,
): Result<CreationCapture<Id>> {
  return capturedElsewhere(capture, active) ? foreignDraft() : { ok: true, value: capture };
}

/** The new diagram: an empty grid placed after the collection's existing diagrams. */
export function diagramChanges(
  capture: CreationCapture<Section['id']>,
  draft: AddDiagramDraft,
): readonly Change[] {
  return [{ op: 'create', target: 'sections', value: diagramSection(capture, draft) }];
}

/** The diagram an object or group is added to, read from its capture when there is one. */
export function creationContext(
  active: ActiveDiagram | null,
  capture: CreationCapture<unknown> | null,
  section: string,
): Result<CreationContext> {
  if (active === null) return creationFailure('Open a collection first.');
  return capturedContext(active, capture, section);
}

/** The new or reused object and the diagram showing it; a new object is created first. */
export function objectChanges(
  context: CreationContext,
  draft: AddObjectDraft,
  id: DiagramObject['id'],
  groups: IdGrammar<Group['id']>,
): Result<readonly Change[]> {
  const object = creationObject(context.active.document.collection.objects, draft, id);
  if (!object.ok) return object;
  return shownObject(context.section, object.value, draft, groups);
}

/** The diagram with the new group, and room made for it when the draft allows. */
export function groupChanges(
  section: Section,
  draft: AddGroupDraft,
  id: Group['id'],
): Result<readonly Change[]> {
  const problem = groupDraftProblem(draft, section);
  if (problem !== null) return creationFailure(problem);
  const grouped = { ...section, groups: [...section.groups, groupRecord(section, draft, id)] };
  return { ok: true, value: groupCreationChanges(grouped, draft.findRoom === true) };
}

/** An Add-form failure, fixed by correcting the form. */
export function creationFailure<T = never>(message: string): Extract<Result<T>, { ok: false }> {
  return {
    ok: false,
    error: diagnostic(
      'invalid-creation',
      message,
      'Correct the Add form and try again.',
      'workspace',
    ),
  };
}

/** The open diagram, once the draft has a name. */
function namedDiagram(
  active: ActiveDiagram,
  draft: AddDiagramDraft,
): Result<ActiveDiagram> {
  return draft.title.trim().length === 0
    ? creationFailure('Give the diagram a name before adding it.')
    : { ok: true, value: active };
}

/** The draft was captured in another collection. */
function foreignDraft(): Extract<Result<never>, { ok: false }> {
  return creationFailure('This draft belongs to another collection. Reopen it there or cancel it.');
}

/** An empty grid diagram, ordered after the captured collection's diagrams. */
function diagramSection(
  capture: CreationCapture<Section['id']>,
  draft: AddDiagramDraft,
): Section {
  return {
    id: capture.id,
    title: draft.title.trim(),
    mode: draft.mode,
    order: capture.collection.sections.length,
    layout: { algorithm: 'grid', direction: 'right', gap: 'normal', constraints: [] },
    appearances: [],
    groups: [],
    wires: [],
    sequence: [],
  };
}

/** The open diagram as captured, or as it is now when nothing is captured. */
function capturedContext(
  active: ActiveDiagram,
  capture: CreationCapture<unknown> | null,
  section: string,
): Result<CreationContext> {
  if (capture === null) return contextIn(active, section);
  return capturedElsewhere(capture, active)
    ? foreignDraft()
    : contextIn(asCaptured(active, capture), section);
}

/** The open diagram with the capture's snapshot, generation and collection. */
function asCaptured(
  active: ActiveDiagram,
  capture: CreationCapture<unknown>,
): ActiveDiagram {
  return {
    ...active,
    base: capture.base,
    generation: capture.generation,
    document: { ...active.document, collection: capture.collection },
  };
}

/** The named diagram in this collection. */
function contextIn(
  active: ActiveDiagram,
  section: string,
): Result<CreationContext> {
  const found = active.document.collection.sections.find((item) => item.id === section);
  if (found === undefined) return creationFailure('Choose an existing diagram.');
  return { ok: true, value: { active, section: found } };
}

/** The object to show: the reused one, or a new one with the draft's name. */
function creationObject(
  objects: readonly DiagramObject[],
  draft: AddObjectDraft,
  id: DiagramObject['id'],
): Result<DiagramObject> {
  if (draft.reuseObject !== null) return existingObject(objects, draft.reuseObject);
  const label = draft.label.trim();
  if (label.length === 0) return creationFailure('Give the object a name before adding it.');
  return { ok: true, value: newObject(id, draft.kind, label) };
}

/** The object to reuse, which must exist. */
function existingObject(
  objects: readonly DiagramObject[],
  id: string,
): Result<DiagramObject> {
  const object = objects.find((item) => item.id === id);
  return object === undefined
    ? creationFailure('Choose an existing object to reuse.')
    : { ok: true, value: object };
}

/** A new neutral, medium object with no content. */
function newObject(
  id: DiagramObject['id'],
  kind: AddObjectDraft['kind'],
  label: string,
): DiagramObject {
  return {
    id,
    kind,
    label,
    role: 'neutral',
    size: 'medium',
    frame: 'auto',
    composition: 'stack',
    content: [],
    ports: [],
    sources: [],
  };
}

/** The object shown in the diagram, which must not show it already. */
function shownObject(
  section: Section,
  object: DiagramObject,
  draft: AddObjectDraft,
  groups: IdGrammar<Group['id']>,
): Result<readonly Change[]> {
  if (section.appearances.some((appearance) => appearance.object === object.id))
    return creationFailure('That object is already in this diagram.');
  return groupedObject(section, object, draft, groups);
}

/** The appearance in the draft's group; a group outside Model's ID grammar is refused. */
function groupedObject(
  section: Section,
  object: DiagramObject,
  draft: AddObjectDraft,
  groups: IdGrammar<Group['id']>,
): Result<readonly Change[]> {
  const group = draftGroup(draft.group, groups);
  if (!group.ok) return group;
  const shown = {
    ...section,
    appearances: [...section.appearances, appearanceFor(object.id, group.value)],
  };
  return { ok: true, value: objectRecords(object, draft.reuseObject, shown) };
}

/** The draft's group as a Model group ID; null when the object joins no group. */
function draftGroup(
  group: string | null,
  groups: IdGrammar<Group['id']>,
): Result<Group['id'] | null> {
  if (group === null) return { ok: true, value: null };
  const parsed = groups.safeParse(group);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : creationFailure('Choose an existing group.');
}

/** A full-detail appearance, in the group when there is one. */
function appearanceFor(
  object: DiagramObject['id'],
  group: Group['id'] | null,
): Appearance {
  return group === null ? { object, detail: 'full' } : { object, detail: 'full', group };
}

/** A new object is created before the diagram showing it is replaced; a reused one is not. */
function objectRecords(
  object: DiagramObject,
  reuseObject: string | null,
  section: Section,
): readonly Change[] {
  const appearance: Change = { op: 'replace', target: 'sections', value: section };
  return reuseObject === null
    ? [{ op: 'create', target: 'objects', value: object }, appearance]
    : [appearance];
}

/** A neutral panel group laid out like its diagram. */
function groupRecord(
  section: Section,
  draft: AddGroupDraft,
  id: Group['id'],
): Group {
  return {
    id,
    title: draft.title.trim(),
    frame: 'panel',
    role: 'neutral',
    layout: {
      algorithm: section.layout.algorithm,
      direction: section.layout.direction,
      gap: section.layout.gap,
      constraints: [],
    },
  };
}
