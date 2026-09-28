import type { WorkspaceView } from '../../contract/records/workspace.js';
import type { Target } from '../../contract/records/owners.js';
import type { ObjectSelection } from '../../contract/records/inspector.js';
/** Inspector follows explicit canonical identity carried by Presentation; generated scene IDs are opaque. */
export function selectedObject(
  view: Pick<WorkspaceView, 'active'>,
  target: Target | undefined,
): ObjectSelection | null {
  if (view.active === null) return null;
  if (target?.kind !== 'node') return null;
  const active = view.active;
  const section = active.document.scene.sections.find((section) => section.id === target.section);
  const node = section?.nodes.find((node) => node.id === target.id);
  const object = active.document.collection.objects.find(
    (object) => object.id === node?.measured.objectId,
  );
  return objectSelection(view, object);
}
/** A deleted or nonsemantic group target presents no fabricated editable object. */
function objectSelection(
  view: Pick<WorkspaceView, 'active'>,
  object: ObjectSelection['object'] | undefined,
): ObjectSelection | null {
  if (view.active === null) return null;
  if (object === undefined) return null;
  return {
    base: view.active.base,
    generation: view.active.generation,
    collection: view.active.document.collection,
    object,
  };
}
