/*
 * The Add panel: three forms that add a diagram, an object or a group to the open collection.
 * Core builds the panel view from the local drafts; this adapter draws it and forwards edits. An
 * edit sets the local draft, then the controller's; a submit locks the forms before the controller
 * call, and new controller creation state replaces the local copies. The add calls return a
 * Result; a failure is also published as `creation.problem`, which the panel shows in its alert,
 * so the returned Results are deliberately not read here. The forms arrive as slots from
 * composition.
 */
import { useEffect, useRef, useState } from 'react';
import type { FunctionComponent, ReactElement } from 'react';
import { buildCreationPanel } from '../../contract/api.js';
import type {
  AddFormComponents,
  AddToolsProps,
  CreationCommands,
} from '../../contract/creation-react.js';
import type {
  AddDiagramDraft,
  AddGroupDraft,
  AddObjectDraft,
  CreationDrafts,
  CreationKind,
  CreationView,
} from '../../contract/records/creation.js';
import styles from './AddTools.module.css';

/** Narrow semantic authoring controls. Drafts stay local until an explicit submit. */
export function createAddTools({
  DiagramForm,
  ObjectForm,
  GroupForm,
}: AddFormComponents): FunctionComponent<AddToolsProps> {
  /** The problem line over the Diagram, Object and Group forms. */
  function AddTools({ controller, view }: AddToolsProps): ReactElement {
    const local = useLocalCreation(controller, view.creation);
    const panel = buildCreationPanel(local.drafts, view);
    return (
      <div className={styles.tools}>
        <CreationProblem problem={panel.problem} />
        <DiagramForm
          form={panel.diagram}
          onDraft={local.setDiagram}
          onCancel={() => controller.cancelCreation('diagram')}
          onSubmit={(request) => local.send('diagram', () => controller.addDiagram(request))}
        />
        <ObjectForm
          form={panel.object}
          onDraft={local.setObject}
          onCancel={() => controller.cancelCreation('object')}
          onSubmit={(request) => local.send('object', () => controller.addObject(request))}
        />
        <GroupForm
          form={panel.group}
          onDraft={local.setGroup}
          onCancel={() => controller.cancelCreation('group')}
          onSubmit={(request) => local.send('group', () => controller.addGroup(request))}
        />
      </div>
    );
  }

  return AddTools;
}

/** The local drafts and lock, a send that locks first, and setters that also tell the controller. */
interface LocalCreation {
  readonly drafts: CreationDrafts;
  readonly send: (kind: CreationKind, add: () => Promise<unknown>) => Promise<void>;
  readonly setDiagram: (draft: AddDiagramDraft) => void;
  readonly setObject: (draft: AddObjectDraft) => void;
  readonly setGroup: (draft: AddGroupDraft) => void;
}

/**
 * Local copies of the drafts and the lock. An edit sets the copy, then tells the controller; a
 * send locks the forms, then calls the controller; new controller creation state replaces all five.
 */
function useLocalCreation(
  controller: Pick<CreationCommands, 'setDiagramDraft' | 'setObjectDraft' | 'setGroupDraft'>,
  creation: CreationView,
): LocalCreation {
  const [diagram, setDiagramLocal] = useState(creation.diagram);
  const [object, setObjectLocal] = useState(creation.object);
  const [group, setGroupLocal] = useState(creation.group);
  const [busy, setBusy] = useState(creation.busy);
  const [adding, setAdding] = useState(creation.adding);
  useEffect(() => {
    setDiagramLocal(creation.diagram);
    setObjectLocal(creation.object);
    setGroupLocal(creation.group);
    setBusy(creation.busy);
    setAdding(creation.adding);
  }, [creation]);
  return {
    drafts: { diagram, object, group, busy, adding },
    send: async (kind, add) => {
      setBusy(true);
      setAdding(kind);
      await add();
    },
    setDiagram: (draft) => {
      setDiagramLocal(draft);
      controller.setDiagramDraft(draft);
    },
    setObject: (draft) => {
      setObjectLocal(draft);
      controller.setObjectDraft(draft);
    },
    setGroup: (draft) => {
      setGroupLocal(draft);
      controller.setGroupDraft(draft);
    },
  };
}

/** The panel may be scrolled to the form below, so a new problem scrolls itself into view. */
function CreationProblem({ problem }: { readonly problem: string | null }): ReactElement | null {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [problem]);
  if (problem === null) return null;
  return (
    <p ref={ref} role="alert">
      {problem}
    </p>
  );
}
