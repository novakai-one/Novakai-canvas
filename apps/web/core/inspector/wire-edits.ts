import type { Change, Relationship, WireAppearance } from '../../contract/records/owners.js';
import type { WireDraft, WireEdit, EditedWire } from '../../contract/records/wire-editor.js';
import type {
  CollectionId,
  RelationshipId,
  SectionId,
  WireDraftKey,
} from '../../contract/brands.js';
import { wireDraftKeySchema } from '../../contract/brands.js';
/**
 * The key of a wire's form: its collection, section and relationship, as JSON text. The shared
 * relationship plus the local section name the form without parsing generated scene IDs. The only
 * maker of `WireDraftKey`; never fails.
 */
export function wireDraftKey(
  collection: CollectionId,
  section: SectionId,
  relationship: RelationshipId,
): WireDraftKey {
  return wireDraftKeySchema.parse(JSON.stringify([collection, section, relationship]));
}
/** Replay against the captured version, even after an agent changes the displayed collection. */
export function editedWire(draft: WireDraft): EditedWire {
  return draft.edits.reduce(applyWireEdit, { relationship: draft.relationship, wire: draft.wire });
}
/** A closed command registry separates semantic edits from local appearance edits. */
const operations: Readonly<
  Record<WireEdit['kind'], (current: EditedWire, edit: WireEdit) => EditedWire>
> = {
  label: text,
  guard: text,
  effect: text,
  'relationship-kind': relationshipKind,
  style,
  endpoint,
  cardinality,
  route,
  side,
  locked,
  'automatic-route': automatic,
};
/** Each operation preserves every field outside its declared scope. */
function applyWireEdit(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  return operations[edit.kind](current, edit);
}
/** A blank label can be typed and recovered; Model rejects it at apply. */
function text(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'label' && edit.kind !== 'guard' && edit.kind !== 'effect') return current;
  return { ...current, relationship: { ...current.relationship, [edit.kind]: edit.value } };
}
/** Changing notation does not silently discard cardinalities or other semantics. */
function relationshipKind(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'relationship-kind') return current;
  return { ...current, relationship: { ...current.relationship, kind: edit.value } };
}
/** Line style belongs to the shared relationship and is visible in every appearance. */
function style(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'style') return current;
  return { ...current, relationship: { ...current.relationship, style: edit.value } };
}
/** Endpoints are stable object/member identities; layout chooses their pixel anchors. */
function endpoint(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'endpoint') return current;
  return { ...current, relationship: { ...current.relationship, [edit.side]: edit.value } };
}
/** Clearing multiplicity removes the optional property rather than storing an invalid sentinel. */
function cardinality(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'cardinality') return current;
  return { ...current, relationship: withCardinality(current.relationship, edit) };
}
/** Both endpoint multiplicities are independent; Model checks whether the chosen relationship permits them. */
function withCardinality(
  relationship: Relationship,
  edit: Extract<WireEdit, { kind: 'cardinality' }>,
): Relationship {
  const { [edit.side]: omitted, ...remaining } = relationship;
  void omitted;
  if (edit.value === 'none') return remaining;
  return { ...remaining, [edit.side]: edit.value };
}
/** Routing style is local to the selected diagram, retaining authored bends until explicitly reset. */
function route(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'route') return current;
  return { ...current, wire: { ...current.wire, route: edit.value } };
}
/** Attachment sides constrain the local router, not the semantic endpoints. */
function side(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'side') return current;
  return { ...current, wire: { ...current.wire, [edit.side]: edit.value } };
}
/** A lock is valid only with manual points; the form disables it until bends exist and Model enforces the invariant. */
function locked(
  current: EditedWire,
  edit: WireEdit,
): EditedWire {
  if (edit.kind !== 'locked') return current;
  return { ...current, wire: { ...current.wire, locked: edit.value } };
}
/** Reset removes the complete manual constraint; no stale lock or point list survives. */
function automatic(current: EditedWire): EditedWire {
  const { manual, ...wire } = current.wire;
  void manual;
  return { ...current, wire: { ...wire, locked: false, sourceSide: 'auto', targetSide: 'auto' } };
}
/** Submit one atomic Model change list. Unchanged shared or local records are not needlessly replaced. */
export function wireChanges(draft: WireDraft): readonly Change[] {
  const edited = editedWire(draft);
  return [
    ...relationshipChanges(draft.relationship, edited.relationship),
    ...explicitRouteReset(draft),
    ...routeChanges(draft, edited.wire),
  ];
}
/** Model preserves omitted manual points on replace; its explicit reset operation must precede that replacement. */
function explicitRouteReset(draft: WireDraft): readonly Change[] {
  if (!draft.edits.some((edit) => edit.kind === 'automatic-route')) return [];
  return [{ op: 'reset-route', section: draft.section.id, relationship: draft.relationship.id }];
}
/** Reference identity is retained until a semantic command actually changes the relationship. */
function relationshipChanges(
  original: Relationship,
  next: Relationship,
): readonly Change[] {
  if (original === next) return [];
  return [{ op: 'replace', target: 'relationships', value: next }];
}
/** Only one wire appearance is replaced inside its captured section. */
function routeChanges(
  draft: WireDraft,
  next: WireAppearance,
): readonly Change[] {
  if (draft.wire === next) return [];
  const section = {
    ...draft.section,
    wires: draft.section.wires.map((wire) =>
      wire.relationship === next.relationship ? next : wire,
    ),
  };
  return [{ op: 'replace', target: 'sections', value: section }];
}
