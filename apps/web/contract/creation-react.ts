/*
 * React slots for the Add panel. The panel receives its three forms as slots, and the forms
 * receive their fields as slots, so the three adapters never import each other;
 * compose/features.ts builds them once. The panel receives only the commands it sends.
 */
import type { ComponentType } from 'react';
import type { DesignSlots } from './react-types.js';
import type {
  AddDiagramDraft,
  AddGroupDraft,
  AddObjectDraft,
  FormView,
  GroupFormView,
  ObjectFormView,
  SubmitView,
} from './records/creation.js';
import type { Section } from './records/owners.js';
import type { WorkspaceController, WorkspaceView } from './records/workspace.js';

/** The workspace commands the Add panel sends: draft edits, cancel and the three adds. */
export type CreationCommands = Pick<
  WorkspaceController,
  | 'setDiagramDraft'
  | 'setObjectDraft'
  | 'setGroupDraft'
  | 'cancelCreation'
  | 'addDiagram'
  | 'addObject'
  | 'addGroup'
>;

/** The Add panel's commands, and the parts of the workspace view it reads. */
export interface AddToolsProps {
  readonly controller: CreationCommands;
  readonly view: Pick<WorkspaceView, 'active' | 'problem' | 'creation'>;
}

/** The three Add forms. A null Object or Group view means there is no diagram to add to. */
export interface AddFormComponents {
  readonly DiagramForm: ComponentType<AddFormProps<AddDiagramDraft, FormView<AddDiagramDraft>>>;
  readonly ObjectForm: ComponentType<AddFormProps<AddObjectDraft, ObjectFormView | null>>;
  readonly GroupForm: ComponentType<AddFormProps<AddGroupDraft, GroupFormView | null>>;
}

/** A form's view, and its draft, cancel and submit callbacks. */
export interface AddFormProps<Draft, View> {
  readonly form: View;
  readonly onDraft: (draft: Draft) => void;
  readonly onCancel: () => void;
  readonly onSubmit: (request: Draft) => Promise<void>;
}

/** The design's Field and the Add fields the forms draw with. */
export type AddFormsSlots = Pick<DesignSlots, 'Field'> & AddFieldComponents;

/** The Add fields: the Diagram select, the name inputs and the form buttons. */
export interface AddFieldComponents {
  readonly DiagramField: ComponentType<DiagramFieldProps>;
  readonly ModuleField: ComponentType<ModuleFieldProps>;
  readonly NameField: ComponentType<NameFieldProps>;
  readonly FormActions: ComponentType<FormActionsProps>;
}

/** The diagram an Object or Group add targets, typed as the form views type it. */
type TargetSection = ObjectFormView['section'] | GroupFormView['section'];

/** The diagrams that take adds, the chosen one, the shared lock and the change callback. */
export interface DiagramFieldProps {
  readonly sections: readonly Section[];
  readonly section: TargetSection;
  readonly busy: boolean;
  readonly onSection: (section: TargetSection) => void;
}

/** The Object form's view and its draft callback. */
export interface ModuleFieldProps {
  readonly form: ObjectFormView;
  readonly onDraft: (draft: AddObjectDraft) => void;
}

/** A name input's label, its value, the shared lock and the change callback. */
export interface NameFieldProps {
  readonly label: string;
  readonly value: string;
  readonly busy: boolean;
  readonly onName: (name: string) => void;
}

/** The shared lock, the form's submit button and the cancel callback. */
export interface FormActionsProps {
  readonly busy: boolean;
  readonly submit: SubmitView;
  readonly onCancel: () => void;
}
