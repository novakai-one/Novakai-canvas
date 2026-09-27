/*
 * The Add panel view: the problem line and one view per form, built from the panel's local drafts
 * and the open collection. Each form gets its submit label and lock, and the request a submit
 * sends. The Object and Group forms are null when the collection has no diagram that takes adds.
 * Pure and derived each render; nothing to recover.
 */
import type {
  AddDiagramDraft,
  AddObjectDraft,
  CreationDrafts,
  CreationKind,
  CreationPanel,
  FormView,
  GroupFormView,
  ObjectFormView,
  SubmitView,
} from '../../contract/records/creation.js';
import type { DiagramObject, Section } from '../../contract/records/owners.js';
import type { WorkspaceView } from '../../contract/records/workspace.js';
import type { ObjectId } from '../../contract/brands.js';
import { shownProblem } from './problem.js';
import { addableSections, presentObjects, reuseChoices, selectedSection } from './targets.js';

/** The problem line and one view per form, from the local drafts and the open collection. */
export function buildCreationPanel(
  drafts: CreationDrafts,
  view: Pick<WorkspaceView, 'active' | 'problem' | 'creation'>,
): CreationPanel {
  const collection = view.active?.document.collection ?? null;
  const sections = addableSections(collection);
  return {
    problem: shownProblem(view),
    diagram: diagramForm(drafts),
    object: objectForm(drafts, sections, collection?.objects ?? []),
    group: groupForm(drafts, sections),
  };
}

/** The Diagram form; its request is the draft itself. */
function diagramForm(drafts: CreationDrafts): FormView<AddDiagramDraft> {
  const draft = drafts.diagram;
  return {
    draft,
    busy: drafts.busy,
    submit: submitView(drafts, 'diagram', 'Add diagram', drafts.busy || blank(draft.title)),
    request: draft,
  };
}

/** The Object form over its target diagram; null when no diagram takes adds. */
function objectForm(
  drafts: CreationDrafts,
  sections: readonly Section[],
  objects: readonly DiagramObject[],
): ObjectFormView | null {
  const draft = drafts.object;
  const target = selectedSection(draft.section, sections);
  if (target === null) return null;
  const present = presentObjects(target);
  const duplicate = isDuplicate(draft, present);
  return {
    draft,
    busy: drafts.busy,
    sections,
    section: target.id,
    reuse: reuseChoices(objects, present),
    groups: target.groups,
    newModule: draft.reuseObject === null,
    duplicate,
    submit: submitView(
      drafts,
      'object',
      objectActionLabel(draft),
      duplicate || objectDisabled(drafts.busy, draft),
    ),
    request: { ...draft, section: target.id },
  };
}

/** The Group form over its target diagram; null when no diagram takes adds. */
function groupForm(
  drafts: CreationDrafts,
  sections: readonly Section[],
): GroupFormView | null {
  const draft = drafts.group;
  const target = selectedSection(draft.section, sections);
  if (target === null) return null;
  return {
    draft,
    busy: drafts.busy,
    sections,
    section: target.id,
    findRoom: draft.findRoom ?? false,
    submit: submitView(drafts, 'group', 'Add group', drafts.busy || blank(draft.title)),
    request: { ...draft, section: target.id },
  };
}

/** A submit button; only the form whose add is unsettled says "Adding…". */
function submitView(
  drafts: CreationDrafts,
  kind: CreationKind,
  label: string,
  disabled: boolean,
): SubmitView {
  return { label: drafts.busy && drafts.adding === kind ? 'Adding…' : label, disabled };
}

/** Whether the draft reuses an object the target diagram already shows. */
function isDuplicate(
  draft: AddObjectDraft,
  present: ReadonlySet<ObjectId>,
): boolean {
  return draft.reuseObject !== null && present.has(draft.reuseObject);
}

/** A new module is added; a chosen object is reused. */
function objectActionLabel(draft: AddObjectDraft): string {
  return draft.reuseObject === null ? 'Add module' : 'Reuse object';
}

/** Locked while busy; a new module also needs a name. */
function objectDisabled(
  busy: boolean,
  draft: AddObjectDraft,
): boolean {
  return busy || (draft.reuseObject === null && blank(draft.label));
}

/** Whether a name is empty once spaces are trimmed. */
function blank(title: string): boolean {
  return title.trim().length === 0;
}
