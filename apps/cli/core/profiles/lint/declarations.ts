/*
 * Reading profile declarations: the source's declaration index, fields, references, ids,
 * descendants, shown objects and orders. Pure vocabulary; no rules live here.
 */
import type { Declaration, ParsedSource } from '../../../contract/records/foreign.js';

export type { Declaration };

/** A full canvas document's declaration and its top-level sections, nodes and wires. */
export interface DeclarationIndex {
  readonly declaration: Declaration;
  readonly sections: readonly Declaration[];
  readonly nodes: readonly Declaration[];
  readonly wires: readonly Declaration[];
}

/** A parsed field value: the profile AST stores values as unknown. */
export type SyntaxValue = unknown;

/** A reference field value: kind 'reference' with a string id. */
export type Reference = { readonly kind: 'reference'; readonly id: string };

/**
 * What {@link wireEnds} reads off one wire. `complete`: the wire has an id, a source and a target.
 * `incomplete`: one of them is missing; the id is kept when the wire has one.
 */
export type WireEnds =
  | {
      readonly kind: 'complete';
      readonly id: string;
      readonly source: string;
      readonly target: string;
    }
  | { readonly kind: 'incomplete'; readonly id?: string };

/** The index of a full canvas document; undefined for any other source (a patch). */
export function indexSource(source: ParsedSource): DeclarationIndex | undefined {
  if (source.kind !== 'canvas') return undefined;
  const declaration = source.declaration;
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

/** The reference of a field value, when the value is one. */
export function reference(value: SyntaxValue | undefined): Reference | undefined {
  return isReference(value) ? value : undefined;
}

/** The id of a declaration, when its id field is a reference. */
export function id(declaration: Declaration): string | undefined {
  return reference(field(declaration, 'id'))?.id;
}

/** The ids referenced by a list field. */
export function ids(
  declaration: Declaration,
  name: string,
): readonly string[] {
  const value = field(declaration, name);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const ref = reference(item);
    return ref === undefined ? [] : [ref.id];
  });
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

/** The first section with the given id, when one exists. */
export function sectionById(
  sections: readonly Declaration[],
  sectionId: string,
): Declaration | undefined {
  return sections.find((section) => id(section) === sectionId);
}

/** The object ids a section shows. */
export function shown(section: Declaration): readonly string[] {
  return section.children
    .filter((child) => child.kind === 'show')
    .flatMap((child) => ids(child, 'ids'));
}

/** The wire ids a section connects. */
export function connected(section: Declaration): readonly string[] {
  return section.children
    .filter((child) => child.kind === 'connect')
    .flatMap((child) => ids(child, 'ids'));
}

/** A wire's own id and its source and target object ids; `incomplete` when any is missing. */
export function wireEnds(wire: Declaration): WireEnds {
  const wireId = id(wire);
  const source = reference(field(wire, 'source'))?.id;
  const target = reference(field(wire, 'target'))?.id;
  if (wireId === undefined || source === undefined || target === undefined)
    return incompleteEnds(wireId);
  return { kind: 'complete', id: wireId, source, target };
}

/** The wire has an id and `connectedIds` (a section's connect list) holds it. */
export function isConnectedWire(
  wire: Declaration,
  connectedIds: ReadonlySet<string>,
): boolean {
  const wireId = id(wire);
  return wireId !== undefined && connectedIds.has(wireId);
}

/** The numeric order field of a section, when it is a number. */
export function order(section: Declaration): number | undefined {
  const value = field(section, 'order');
  return typeof value === 'number' ? value : undefined;
}

/** Incomplete ends, keeping the wire's id only when it has one. */
function incompleteEnds(wireId: string | undefined): WireEnds {
  return wireId === undefined ? { kind: 'incomplete' } : { kind: 'incomplete', id: wireId };
}

/** A field value that is an object with kind 'reference' and a string id. */
function isReference(value: SyntaxValue | undefined): value is Reference {
  return (
    isNonNullObject(value) &&
    'kind' in value &&
    'id' in value &&
    value.kind === 'reference' &&
    typeof value.id === 'string'
  );
}

/** The value is a plain object: not null, not an array. */
function isNonNullObject(value: SyntaxValue | undefined): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
