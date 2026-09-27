import type { Target } from '../../contract/records/owners.js';
import type { WorkspaceView } from '../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import type { WireSelection } from '../../contract/records/wire-editor.js';
/** Resolve a selected wire through the projection's canonical identity, never a generated-ID convention. */
export function selectedWire(
  view: WorkspaceView,
  target: Target | undefined,
): WireSelection | null {
  if (view.active === null) return null;
  if (target?.kind !== 'wire') return null;
  return resolveWire(view.active, target);
}
/** A disappearing wire leaves a retained draft but does not fabricate a new editable selection. */
function resolveWire(
  active: ActiveDiagram,
  target: Extract<Target, { kind: 'wire' }>,
): WireSelection | null {
  const projection = active.document.projection.sections.find(
    (section) => section.id === target.section,
  );
  const visual = projection?.wires.find((wire) => wire.id === target.id);
  const collection = active.document.collection;
  const section = collection.sections.find((section) => section.id === target.section);
  const relationship = collection.relationships.find((item) => item.id === visual?.relationshipId);
  const wire = section?.wires.find((item) => item.relationship === relationship?.id);
  if (!section || !relationship || !wire) return null;
  return {
    base: active.base,
    generation: active.generation,
    collection,
    section,
    relationship,
    wire,
  };
}
