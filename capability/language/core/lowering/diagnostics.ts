/*
 * Mapping Model's results back to the source. `sourceMappings` records where each declaration,
 * and the parts of it Model reports on, was written, under the path Model uses. `ownerValue`
 * returns a successful Model result, or turns every Model diagnostic into a `domain` diagnostic
 * at the nearest written span. Model's message text is never parsed. Pure: nothing is written.
 * Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Span, Declaration, LocatedValue, Token } from '../../contract/records/syntax.js';
import type { SourceMapping } from '../../contract/records/requests.js';
import { LanguageFault } from '../../contract/errors.js';
import type { OwnerDiagnostic, Result, Diagnostic } from '../../contract/errors.js';
import { id } from './fields.js';
import { copySpan } from '../validation/ownership.js';

/** A failed Model result: at least one diagnostic. */
interface OwnerError {
  readonly code: 'validation-failed';
  readonly diagnostics: readonly [OwnerDiagnostic, ...OwnerDiagnostic[]];
}

/** Mappings read from part of a type expression, and where reading stopped. */
interface MappingParse {
  readonly next: number;
  readonly mappings: readonly SourceMapping[];
  readonly items: number;
}

/**
 * Returns a copy of a successful Model result's value, or stops with every Model diagnostic
 * placed in the source.
 *
 * Each Model diagnostic becomes a `domain` diagnostic in the same order: `target` is Model's
 * path, `expected` is Model's code, `message` is Model's message, `source` is a shallow copy of
 * Model's diagnostic, and `span` is a copy of the span of the longest mapping path contained
 * in Model's path (the narrower span wins a tie), else of `fallback`.
 *
 * @throws A `LanguageFault` holding the translated diagnostics when the result failed; a
 * `DataCloneError` when the value cannot be cloned.
 */
export function ownerValue<T>(
  result: Result<T, OwnerError>,
  mappings: readonly SourceMapping[],
  fallback: Span,
): T {
  if (result.ok) return structuredClone(result.value);
  const [first, ...remaining] = result.error.diagnostics;
  return rejectOwner(first, remaining, mappings, fallback);
}

/**
 * Lists where a declaration and everything inside it was written, under the paths Model uses.
 *
 * For each declaration, in this order: the declaration itself; a sequence event's `operation`;
 * a member's `type`, or a signature's `returns` and each parameter (a pair maps its name and
 * type separately); each reference inside a `type` definition's expression, then the whole
 * expression; then every child, depth first. The collection maps to the empty path; a top-level
 * declaration to `objects`, `relationships`, `sections`, `assets`, `sources` or `definitions`
 * plus its ID; a nested one to its parent's path plus `ports`, `rows`, `groups`, `sequence` or
 * `branches` (else `content`) and its ID; one without an ID keeps its parent's path.
 *
 * Every mapping holds a copy of the written span, never the declaration's own span object.
 *
 * @throws A `LanguageFault` for a nested or top-level declaration whose `id` is not an ID (see
 * `id`).
 */
export function sourceMappings(
  item: Declaration,
  prefix = '',
): readonly SourceMapping[] {
  const name = mappingPath(item, prefix);
  const expression = item.kind === 'type' ? item.fields.expression : undefined;
  return [
    { path: name, span: copySpan(item.span) },
    ...contentMappings(name, item),
    ...expressionMapping(name, expression),
    ...item.children.flatMap((child) => sourceMappings(child, name)),
  ];
}

/** Every issue is translated, in order; the result is never empty. */
function rejectOwner(
  first: OwnerDiagnostic,
  remaining: readonly OwnerDiagnostic[],
  mappings: readonly SourceMapping[],
  fallback: Span,
): never {
  throw new LanguageFault([
    sourceDiagnostic(first, mappings, fallback),
    ...remaining.map((issue) => sourceDiagnostic(issue, mappings, fallback)),
  ]);
}

/**
 * Adds a source span (a copy) to Model's issue; Model's code and path are kept, never replaced.
 * `source` is a shallow copy of the issue (all its fields), never Model's own object.
 */
function sourceDiagnostic(
  issue: OwnerDiagnostic,
  mappings: readonly SourceMapping[],
  fallback: Span,
): Diagnostic {
  return {
    code: 'domain',
    target: issue.path,
    span: copySpan(nearestSpan(issue.path, mappings, fallback)),
    expected: issue.code,
    message: issue.message,
    source: { ...issue },
    recovery: 'Correct the referenced diagram declaration; check again before Authoring admission.',
  };
}

/** The most specific mapping contained in the path wins; else the fallback. */
function nearestSpan(
  path: string,
  mappings: readonly SourceMapping[],
  fallback: Span,
): Span {
  const containing = mappings.filter((mapping) => path.includes(mapping.path));
  return containing.toSorted(compareSpecificity)[0]?.span ?? fallback;
}

/** Longer paths first; for equal paths, narrower spans first. */
function compareSpecificity(
  left: SourceMapping,
  right: SourceMapping,
): number {
  const pathOrder = right.path.length - left.path.length;
  if (pathOrder !== 0) return pathOrder;
  return spanWidth(left.span) - spanWidth(right.span);
}

/** The number of characters a span covers. */
function spanWidth(span: Span): number {
  return span.end.offset - span.start.offset;
}

/** An event's operation, then a member's or signature's type parts. */
function contentMappings(
  name: string,
  item: Declaration,
): readonly SourceMapping[] {
  return [operationMapping(name, item), ...typeMappings(name, item)].filter(isMapping);
}

/** A sequence event's written `operation`, if any. */
function operationMapping(
  name: string,
  item: Declaration,
): SourceMapping | undefined {
  const operation = item.fields.operation;
  return operation === undefined
    ? undefined
    : { path: `${name}.operation`, span: copySpan(operation.span) };
}

/** A member's `type`; a signature's `returns` and parameters; nothing for other kinds. */
function typeMappings(
  name: string,
  item: Declaration,
): readonly SourceMapping[] {
  if (item.kind === 'member') return propertyMapping(name, 'type', item.fields.type);
  if (item.kind !== 'signature') return [];
  return [
    ...propertyMapping(name, 'returns', item.fields.returns),
    ...(item.fields.parameters?.items ?? []).flatMap((parameter, index) =>
      parameterMappings(name, parameter, index),
    ),
  ];
}

/** One written property, if any. */
function propertyMapping(
  name: string,
  property: string,
  value: LocatedValue | undefined,
): readonly SourceMapping[] {
  return value === undefined ? [] : [{ path: `${name}.${property}`, span: copySpan(value.span) }];
}

/** A text parameter maps as a whole; a `[name, type]` pair maps each part. */
function parameterMappings(
  name: string,
  parameter: LocatedValue,
  index: number,
): readonly SourceMapping[] {
  if (typeof parameter.value === 'string')
    return [{ path: `${name}.parameters.${index}`, span: copySpan(parameter.span) }];
  const tuple = parameter.items ?? [];
  return [
    parameterPartMapping(name, index, 'name', tuple[0]),
    parameterPartMapping(name, index, 'type', tuple[1]),
  ].filter(isMapping);
}

/** One part of a parameter pair, if written. */
function parameterPartMapping(
  name: string,
  index: number,
  part: 'name' | 'type',
  value: LocatedValue | undefined,
): SourceMapping | undefined {
  return value === undefined
    ? undefined
    : { path: `${name}.parameters.${index}.${part}`, span: copySpan(value.span) };
}

/** Whether a mapping is present. */
function isMapping(value: SourceMapping | undefined): value is SourceMapping {
  return value !== undefined;
}

/** A definition's expression: its references first, then the whole expression. */
function expressionMapping(
  name: string,
  expression: LocatedValue | undefined,
): readonly SourceMapping[] {
  if (expression === undefined) return [];
  return [
    ...expressionReferenceMappings(expression.tokens ?? [], `${name}.expression`),
    { path: `${name}.expression`, span: copySpan(expression.span) },
  ];
}

/**
 * The references inside an expression, at the paths lowering gives them: a top-level union's
 * items are `items.N`; a parenthesized union of one item takes its parent's path.
 */
function expressionReferenceMappings(
  tokens: readonly Token[],
  path: string,
): readonly SourceMapping[] {
  if (tokens.length === 0) return [];
  return hasTopLevelUnion(tokens)
    ? mapUnion(tokens, 0, path).mappings
    : mapAtom(tokens, 0, path).mappings;
}

/** Whether a `|` appears outside every parenthesis. */
function hasTopLevelUnion(tokens: readonly Token[]): boolean {
  let depth = 0;
  return tokens.some((token) => {
    depth = unionDepth(token.text, depth);
    return depth === 0 && token.text === '|';
  });
}

/** The depth after a token: `(` opens, `)` closes. */
function unionDepth(
  token: string,
  depth: number,
): number {
  return depth + (unionDepthDelta[token] ?? 0);
}

/** How each parenthesis changes the depth. */
const unionDepthDelta: Readonly<Record<string, number>> = Object.freeze({ '(': 1, ')': -1 });

/** The tokens that end an atom. */
const atomEnds: readonly string[] = Object.freeze(['|', ')']);

/** A union's items, at `items.0`, `items.1`, … under the path. */
function mapUnion(
  tokens: readonly Token[],
  start: number,
  path: string,
): MappingParse {
  let parsed = mapAtom(tokens, start, `${path}.items.0`);
  const mappings: SourceMapping[] = [...parsed.mappings];
  let item = 0;
  while (tokens[parsed.next]?.text === '|') {
    item += 1;
    parsed = mapAtom(tokens, parsed.next + 1, `${path}.items.${item}`);
    mappings.push(...parsed.mappings);
  }
  return { next: parsed.next, mappings, items: item + 1 };
}

/** A parenthesized union, a reference, or any other atom (which maps nothing). */
function mapAtom(
  tokens: readonly Token[],
  start: number,
  path: string,
): MappingParse {
  const token = tokens[start];
  if (token?.text === '(') return mapParenthesized(tokens, start, path);
  if (token?.text.startsWith('@') === true) return mapReference(token, start, path);
  return { next: atomEnd(tokens, start), mappings: [], items: 1 };
}

/** The union inside parentheses; a single item takes the parenthesis's own path. */
function mapParenthesized(
  tokens: readonly Token[],
  start: number,
  path: string,
): MappingParse {
  const nested = mapUnion(tokens, start + 1, path);
  const mappings = nested.items === 1 ? collapseSingleItem(nested.mappings, path) : nested.mappings;
  return { next: nested.next + 1, mappings, items: nested.items };
}

/** A reference token maps to the path. */
function mapReference(
  token: Token,
  start: number,
  path: string,
): MappingParse {
  return { next: start + 1, mappings: [{ path, span: copySpan(token.span) }], items: 1 };
}

/** Moves mappings under `items.0` up to the path itself. */
function collapseSingleItem(
  mappings: readonly SourceMapping[],
  path: string,
): readonly SourceMapping[] {
  const prefix = `${path}.items.0`;
  return mappings.map((mapping) =>
    mapping.path === prefix || mapping.path.startsWith(`${prefix}.`)
      ? { ...mapping, path: `${path}${mapping.path.slice(prefix.length)}` }
      : mapping,
  );
}

/** The index of the next `|` or `)` after the atom's first token, or the end. */
function atomEnd(
  tokens: readonly Token[],
  start: number,
): number {
  let next = start + 1;
  while (next < tokens.length && !atomEnds.includes(tokens[next]?.text ?? '')) next += 1;
  return next;
}

/** The collection maps to the empty path; a declaration without an ID keeps its parent's path. */
function mappingPath(
  item: Declaration,
  prefix: string,
): string {
  if (item.kind === 'collection') return '';
  if (item.fields.id === undefined) return prefix;
  return ownedPath(item, prefix);
}

/** A top-level declaration's path is its Model list plus its ID. */
function ownedPath(
  item: Declaration,
  prefix: string,
): string {
  const top = topLevelLists[item.kind];
  if (top !== undefined) return `${top}.${id(item.fields)}`;
  return descendantPath(item, prefix);
}

/** A nested declaration's path: the parent's path, its Model list (else `content`) and its ID. */
function descendantPath(
  item: Declaration,
  prefix: string,
): string {
  const name = nestedLists[item.kind] ?? 'content';
  return `${prefix}.${name}.${id(item.fields)}`;
}

/** The Model list each top-level construct is stored in. */
const topLevelLists: Readonly<Record<string, string>> = Object.freeze({
  node: 'objects',
  wire: 'relationships',
  section: 'sections',
  asset: 'assets',
  source: 'sources',
  type: 'definitions',
});

/** The Model list each nested construct is stored in; other content is `content`. */
const nestedLists: Readonly<Record<string, string>> = Object.freeze({
  port: 'ports',
  row: 'rows',
  group: 'groups',
  event: 'sequence',
  fragment: 'sequence',
  branch: 'branches',
});
