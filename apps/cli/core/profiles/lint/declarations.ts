/*
 * Reading profile declarations: fields, references, ids and the finding constructors every
 * build-spec lint rule reports through. Pure vocabulary; no rules live here.
 */
import type { ProfileDeclaration, ProfileFinding } from '../../../contract/records/profiles.js';

/** One profile declaration. */
export type Declaration = ProfileDeclaration;

/** A parsed field value: the profile AST stores values as unknown. */
export type SyntaxValue = unknown;

/** A reference field value: kind 'reference' with a string id. */
export type Reference = { readonly kind: 'reference'; readonly id: string };

/** An appendix section parsed from its id: `@flow-51` is mode flow, number 51. */
export type Appendix = {
  readonly section: Declaration;
  readonly id: string;
  readonly number: number;
  readonly mode: string;
};

const appendixPattern = /^(flow|sequence|state)-5([1-9][0-9]*)$/;

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

/** The numeric order field of a section, when it is a number. */
export function order(section: Declaration): number | undefined {
  const value = field(section, 'order');
  return typeof value === 'number' ? value : undefined;
}

/** One finding at the declaration's own span. */
export function findingAt(
  declaration: Declaration,
  path: string,
  message: string,
): ProfileFinding {
  return { path, message, span: declaration.span };
}

/** One finding at a field's span, falling back to the declaration's. */
export function fieldFinding(
  declaration: Declaration,
  name: string,
  path: string,
  message: string,
): ProfileFinding {
  return { path, message, span: declaration.fields[name]?.span ?? declaration.span };
}

/** The appendix sections of a list, parsed from their ids. */
export function collectAppendices(sections: readonly Declaration[]): Appendix[] {
  return sections.flatMap((section) => {
    const sectionId = id(section);
    return sectionId === undefined ? [] : appendixOf(section, sectionId);
  });
}

/** The appendix of one section, or nothing when its id is not an appendix id. */
function appendixOf(
  section: Declaration,
  sectionId: string,
): Appendix[] {
  const match = appendixPattern.exec(sectionId);
  return match === null
    ? []
    : [{ section, id: sectionId, number: Number(match[2]), mode: match[1] ?? '' }];
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
