/*
 * Add panel vocabulary: the retained drafts the workspace session keeps for each Add form, and the
 * panel view Web core builds from them for the React adapter. The draft shapes are persisted
 * session state; the view types are derived each render and never stored.
 */
import type { ObjectKind } from '@novakai/canvas-model';
import type { Group, Section } from './owners.js';
import type { GroupId, ObjectId, SectionId } from '../brands.js';

/** A retained, typed draft for the small set of authoring actions exposed by Add. */
export interface AddDiagramDraft {
  readonly title: string;
  readonly mode: 'grid';
}

/**
 * New objects and reused appearances share one explicit request shape. `section` is null until a
 * diagram is chosen; `reuseObject` is null for a new module, `group` for no group.
 */
export interface AddObjectDraft {
  readonly section: SectionId | null;
  readonly label: string;
  readonly kind: ObjectKind;
  readonly reuseObject: ObjectId | null;
  readonly group: GroupId | null;
}

/**
 * A new group in one diagram; `findRoom` lets that diagram move and resize to fit it. `section` is
 * null until a diagram is chosen.
 */
export interface AddGroupDraft {
  readonly findRoom?: boolean;
  readonly section: SectionId | null;
  readonly title: string;
}

/** The session's Add state: one draft per form, the form problem, and the shared lock. */
export interface CreationView {
  readonly diagram: AddDiagramDraft;
  readonly object: AddObjectDraft;
  readonly group: AddGroupDraft;
  readonly problem: string | null;
  /** Every form is locked while any add is unsettled; only the form that sent it says "Adding…". */
  readonly busy: boolean;
  readonly adding: 'diagram' | 'object' | 'group' | null;
}

/** The Add form an add came from. */
export type CreationKind = NonNullable<CreationView['adding']>;

/** The panel's local copy of the drafts and the lock: the Add state without its problem. */
export type CreationDrafts = Omit<CreationView, 'problem'>;

/** A form's submit button: "Adding…" on the form whose add is unsettled. */
export interface SubmitView {
  readonly label: string;
  readonly disabled: boolean;
}

/** One Add form: its draft, the shared lock, its submit button, and the request a submit sends. */
export interface FormView<Draft> {
  readonly draft: Draft;
  readonly busy: boolean;
  readonly submit: SubmitView;
  readonly request: Draft;
}

/** An object the Object form can reuse; one already in the target diagram is disabled. */
export interface ReuseChoice {
  readonly id: ObjectId;
  readonly label: string;
  readonly disabled: boolean;
}

/** The Object form over its target diagram. `newModule` is false while an object is reused. */
export interface ObjectFormView extends FormView<AddObjectDraft> {
  readonly sections: readonly Section[];
  readonly section: SectionId;
  readonly reuse: readonly ReuseChoice[];
  readonly groups: readonly Group[];
  readonly newModule: boolean;
  readonly duplicate: boolean;
}

/** The Group form over its target diagram. */
export interface GroupFormView extends FormView<AddGroupDraft> {
  readonly sections: readonly Section[];
  readonly section: SectionId;
  readonly findRoom: boolean;
}

/** The Add panel: the problem line and one view per form; a null form has no diagram to add to. */
export interface CreationPanel {
  readonly problem: string | null;
  readonly diagram: FormView<AddDiagramDraft>;
  readonly object: ObjectFormView | null;
  readonly group: GroupFormView | null;
}
