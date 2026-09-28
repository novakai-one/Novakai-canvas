/*
 * Reading profile declarations: the document's declaration index, fields, IDs checked with Model's
 * brands, descendants, shown objects, connected wires and orders. Pure vocabulary; no rules live
 * here.
 */
import { descendantId, objectId, relationshipId, sectionId } from '../../../contract/brands.js';
import type {
  DescendantId,
  IdParser,
  ObjectId,
  RelationshipId,
  SectionId,
} from '../../../contract/brands.js';
import type {
  Declaration,
  Document,
  Reference,
  SyntaxValue,
} from '../../../contract/records/syntax.js';

export type { Declaration };

/** A full canvas document's declaration and its top-level sections, nodes and wires. */
export interface DeclarationIndex {
  readonly declaration: Declaration;
  readonly sections: readonly Declaration[];
  readonly nodes: readonly Declaration[];
  readonly wires: readonly Declaration[];
}

/**
 * What {@link wireEnds} reads off one wire. `complete`: the wire has an ID, a source and a target.
 * `incomplete`: one of them is missing; the ID is kept when the wire has one.
 */
export type WireEnds =
  | {
      readonly kind: 'complete';
      readonly id: RelationshipId;
      readonly source: ObjectId;
      readonly target: ObjectId;
    }
  | { readonly kind: 'incomplete'; readonly id?: RelationshipId };

/** The index of a full canvas document: its top-level sections, nodes and wires. */
export function indexDocument(document: Document): DeclarationIndex {
  const declaration = document.declaration;
  return {
    declaration,
    sections: declaration.children.filter((child) => child.kind === 'section'),
    nodes: declaration.children.filter((child) => child.kind === 'node'),
    wires: declaration.children.filter((child) => child.kind === 'wire'),
  };
}

/** The raw value of a declaration's field, when present. */
export function field(
  declaration: Declaration,
  name: string,
): SyntaxValue | undefined {
  return declaration.fields[name]?.value;
}

/** The string value of a field, when it is a string. */
export function text(
  declaration: Declaration,
  name: string,
): string | undefined {
  const value = field(declaration, name);
  return typeof value === 'string' ? value : undefined;
}

/** A section's own ID as Model's `SectionId`, when it has one. */
export function sectionIdOf(section: Declaration): SectionId | undefined {
  return checkedId(sectionId, ownId(section));
}

/** A node's or root's object ID as Model's `ObjectId`, when it has one. */
export function objectIdOf(declaration: Declaration): ObjectId | undefined {
  return checkedId(objectId, ownId(declaration));
}

/** A table row's own ID as Model's `DescendantId`, when it has one. */
export function rowIdOf(row: Declaration): DescendantId | undefined {
  return checkedId(descendantId, ownId(row));
}

/** Every descendant of one kind, depth-first. */
export function descendants(
  declaration: Declaration,
  kind: Declaration['kind'],
): readonly Declaration[] {
  return declaration.children.flatMap((child) => [
    ...(child.kind === kind ? [child] : []),
    ...descendants(child, kind),
  ]);
}

/** The first section with the given ID, when one exists. */
export function sectionById(
  sections: readonly Declaration[],
  wanted: SectionId,
): Declaration | undefined {
  return sections.find((section) => sectionIdOf(section) === wanted);
}

/** The first node with the given object ID, when one exists. */
export function nodeById(
  nodes: readonly Declaration[],
  wanted: ObjectId,
): Declaration | undefined {
  return nodes.find((node) => objectIdOf(node) === wanted);
}

/** The object IDs a section shows. */
export function shown(section: Declaration): readonly ObjectId[] {
  const references = listedIds(section, 'show');
  return references.flatMap((reference) => checkedIds(objectId, reference));
}

/** The wire IDs a section connects. */
export function connected(section: Declaration): readonly RelationshipId[] {
  const references = listedIds(section, 'connect');
  return references.flatMap((reference) => checkedIds(relationshipId, reference));
}

/** A wire's own ID and its source and target object IDs; `incomplete` when any is missing. */
export function wireEnds(wire: Declaration): WireEnds {
  const wireId = checkedId(relationshipId, ownId(wire));
  const source = checkedId(objectId, reference(field(wire, 'source'))?.id);
  const target = checkedId(objectId, reference(field(wire, 'target'))?.id);
  if (wireId === undefined || source === undefined || target === undefined)
    return incompleteEnds(wireId);
  return { kind: 'complete', id: wireId, source, target };
}

/** The wire has an ID and `connectedIds` (a section's connect list) holds it. */
export function isConnectedWire(
  wire: Declaration,
  connectedIds: ReadonlySet<RelationshipId>,
): boolean {
  const wireId = checkedId(relationshipId, ownId(wire));
  return wireId !== undefined && connectedIds.has(wireId);
}

/** The numeric order field of a section, when it is a number. */
export function order(section: Declaration): number | undefined {
  const value = field(section, 'order');
  return typeof value === 'number' ? value : undefined;
}

/** The ID a declaration's `id` field references, unchecked. */
function ownId(declaration: Declaration): string | undefined {
  return reference(field(declaration, 'id'))?.id;
}

/** The IDs referenced by the `ids` lists of a section's `show` or `connect` children. */
function listedIds(
  section: Declaration,
  kind: 'show' | 'connect',
): readonly string[] {
  return section.children
    .filter((child) => child.kind === kind)
    .flatMap((child) => referencedIds(field(child, 'ids')));
}

/** The IDs of the references in a list value; anything else in the list is skipped. */
function referencedIds(value: SyntaxValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(referencedId);
}

/** The ID a list item references, as a list of one; empty when the item is not a reference. */
function referencedId(item: SyntaxValue): readonly string[] {
  const referenced = reference(item);
  if (referenced === undefined) return [];
  return [referenced.id];
}

/** The ID as `parser` brands it; absent when there is no ID or Model's grammar rejects it. */
function checkedId<T>(
  parser: IdParser<T>,
  unchecked: string | undefined,
): T | undefined {
  if (unchecked === undefined) return undefined;
  const checked = parser.safeParse(unchecked);
  if (!checked.success) return undefined;
  return checked.data;
}

/** The ID as `parser` brands it, as a list of one; empty when Model's grammar rejects it. */
function checkedIds<T>(
  parser: IdParser<T>,
  unchecked: string,
): readonly T[] {
  const checked = parser.safeParse(unchecked);
  if (!checked.success) return [];
  return [checked.data];
}

/** Incomplete ends, keeping the wire's ID only when it has one. */
function incompleteEnds(wireId: RelationshipId | undefined): WireEnds {
  if (wireId === undefined) return { kind: 'incomplete' };
  return { kind: 'incomplete', id: wireId };
}

/** The reference a field value holds, when the value is one. */
function reference(value: SyntaxValue | undefined): Reference | undefined {
  if (!isReference(value)) return undefined;
  return value;
}

/** A field value that is a reference: an object, not a list, whose kind is 'reference'. */
function isReference(value: SyntaxValue | undefined): value is Reference {
  return typeof value === 'object' && 'kind' in value && value.kind === 'reference';
}
