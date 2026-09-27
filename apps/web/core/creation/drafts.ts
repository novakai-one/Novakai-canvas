/*
 * The Add forms' drafts as the view holds them. A form empties after its add lands, when it is
 * cancelled, and when its confirmed request is settled later; a newly opened collection starts with
 * every form empty. An add refused after another collection opened is noted on that collection's
 * forms. Pure; the session decides when and publishes.
 */
import type {
  AddDiagramDraft,
  AddGroupDraft,
  AddObjectDraft,
  CreationKind,
  CreationView,
} from '../../contract/records/creation.js';
import { plainMessage } from '../output/diagnostics.js';

/** Every form empty, unlocked and without a problem. */
export function emptyCreation(): CreationView {
  return {
    diagram: emptyDiagramDraft(),
    object: emptyObjectDraft(),
    group: emptyGroupDraft(),
    problem: null,
    busy: false,
    adding: null,
  };
}

/** After a cancel: that form empty, unlocked and without a problem. */
export function cancelledCreation(
  view: CreationView,
  kind: CreationKind,
): CreationView {
  return { ...emptied(view, kind), problem: null, busy: false };
}

/** After an add lands: that form empty and nothing adding. */
export function addedCreation(
  view: CreationView,
  kind: CreationKind,
): CreationView {
  return { ...emptied(view, kind), problem: null, busy: false, adding: null };
}

/** After confirmed requests settle: the forms that sent them empty, the lock as `locked` says. */
export function settledCreation(
  view: CreationView,
  cleared: readonly CreationKind[],
  locked: boolean,
): CreationView {
  return { ...cleared.reduce(emptied, view), problem: null, busy: locked };
}

/** The note an add refused after another collection opened leaves on the forms. */
export function refusedElsewhereNote(
  title: string,
  message: string,
): string {
  return `Add to "${title}" was not applied: ${plainMessage(message)}`;
}

/** The view with one form emptied. */
function emptied(
  view: CreationView,
  kind: CreationKind,
): CreationView {
  switch (kind) {
    case 'diagram':
      return { ...view, diagram: emptyDiagramDraft() };
    case 'object':
      return { ...view, object: emptyObjectDraft() };
    case 'group':
      return { ...view, group: emptyGroupDraft() };
  }
}

/** An empty Diagram form. */
function emptyDiagramDraft(): AddDiagramDraft {
  return { title: '', mode: 'grid' };
}

/** An empty Object form. */
function emptyObjectDraft(): AddObjectDraft {
  return { section: null, label: '', kind: 'module', reuseObject: null, group: null };
}

/** An empty Group form. */
function emptyGroupDraft(): AddGroupDraft {
  return { section: null, title: '' };
}
