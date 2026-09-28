import type { DefinitionId, DescendantId, ObjectId } from '../contract/brands.js';
import type { Diagnostic, Result } from '../contract/errors.js';
import type { Collection } from '../contract/records/collection.js';
import type { TypeExpression, TypeUse } from '../contract/records/definition.js';
import type { ContentBlock, Field } from '../contract/records/content.js';
import { failure, success } from './invariants/issues.js';
import { diagnoseWhen, referenceIssue } from './invariants/issues.js';

/**
 * One direct use of a definition, addressed by its collection path. `kind` tells which fields are
 * present: uses in object content carry `object` and `field` (a signature parameter also its
 * `parameter` position); a use inside another definition carries only the path.
 */
export type DefinitionUsage = ContentTypeUsage | ParameterTypeUsage | DefinitionReferenceUsage;

/** A use as a field or member `type`, or as a signature's `returns`. */
export interface ContentTypeUsage {
  /** `field` or `member` for a block's `type`; `signature-return` for a signature's `returns`. */
  readonly kind: 'field' | 'member' | 'signature-return';
  /** The definition that is used. */
  readonly definition: DefinitionId;
  /** The collection path of the use, for example `objects.a.content.b.type`. */
  readonly path: string;
  /** The object holding the use. */
  readonly object: ObjectId;
  /** The field, member or signature block holding the use. */
  readonly field: DescendantId;
  /** Never present on this kind of use. */
  readonly parameter?: undefined;
}

/** A use as a signature parameter's type. */
export interface ParameterTypeUsage {
  /** Always `signature-parameter`. */
  readonly kind: 'signature-parameter';
  /** The definition that is used. */
  readonly definition: DefinitionId;
  /** The collection path of the use, for example `objects.a.content.b.parameters.0.type`. */
  readonly path: string;
  /** The object holding the use. */
  readonly object: ObjectId;
  /** The signature block holding the parameter. */
  readonly field: DescendantId;
  /** The parameter's position in the signature. */
  readonly parameter: number;
}

/** A reference inside another definition's expression. */
export interface DefinitionReferenceUsage {
  /** Always `definition`. */
  readonly kind: 'definition';
  /** The definition that is used. */
  readonly definition: DefinitionId;
  /** The collection path of the reference, for example `definitions.b.expression.items.0`. */
  readonly path: string;
  /** Never present on this kind of use. */
  readonly object?: undefined;
  /** Never present on this kind of use. */
  readonly field?: undefined;
  /** Never present on this kind of use. */
  readonly parameter?: undefined;
}

/**
 * Checks shared type definitions and every type use. Every failure is collected, in this order:
 * 1. for each definition in list order: its expression may nest at most 32 levels below the top
 *    ("Definition expression nesting exceeds the limit") and hold at most 256 nodes ("Definition
 *    expression is too large"), both `limit` at the path of the node that crossed the limit, such
 *    as `definitions.<id>.expression.items.0` (only the first limit hit per definition is
 *    reported); then each reference inside it must name a definition (`reference` at the
 *    reference's path). Nodes are visited depth-first, last union item first. Through
 *    `validate`, the input check (at most 64 JSON levels) rejects expressions deeper than 30
 *    levels first, so the nesting message is not reached there;
 * 2. definitions found on a reference cycle (self or mutual), in definition order: `reference`
 *    at `definitions.<id>.expression`, "Definition references form a cycle". A depth-first search
 *    runs from each definition in list order and reports the definitions on each cycle it closes.
 *    Every cycle has at least one reported definition; a definition reached on a cycle only
 *    through an already finished definition is not reported;
 * 3. each type use in object content that references a definition must name one: field and
 *    member `type` (at `objects.<id>.content.<block>.type`), signature parameter types (at
 *    `...parameters.<index>.type`) and signature `returns` (at `...returns`), all `reference`.
 *
 * Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateDefinitionGraph(collection: Collection): readonly Diagnostic[] {
  const definitionIssues = validateDefinitions(collection);
  const cycleIssues = validateCycles(collection);
  const fieldTypeIssues = validateFieldTypes(collection);
  return [...definitionIssues, ...cycleIssues, ...fieldTypeIssues];
}

/**
 * Shows a shared type definition as text, expanding the definitions it references. Published as
 * Model's `definitionDisplay`.
 *
 * Unions are joined with ` | `, string literals are JSON-quoted, other literals and primitive
 * names are written as they are. A reference back to a definition already being expanded, or to
 * a missing one, shows as `@id`; each nested reference gets its own copy of the IDs being
 * expanded. At most 256 expression nodes are shown; a longer display ends with ` …`.
 *
 * Pure: reads only, so calling again gives the same text. Authoring owns correcting the
 * collection.
 *
 * @param collection - A validated collection.
 * @param id - The definition to show.
 * @returns The display text, or `validation-failed` with `not-found` at `definitions.<id>`,
 * "Definition ID must exist", when no definition has that ID. Not frozen.
 * @throws Only if given data that is not a validated collection.
 */
export function definitionDisplay(
  collection: Collection,
  id: DefinitionId,
): Result<string> {
  const exists = collection.definitions.some(
    /** Tells whether this is the definition. */
    (definition) => definition.id === id,
  );
  if (!exists) {
    return failure('not-found', `definitions.${id}`, 'Definition ID must exist');
  }
  return success(resolvedDefinitionDisplay(collection, id));
}

/**
 * Shows a field's type: a plain string type as written, or a definition reference displayed as
 * {@link definitionDisplay} does (a missing definition shows as `@id`). Published as Model's
 * `fieldTypeDisplay`. Pure: reads only.
 *
 * @param collection - A validated collection; references are resolved against it.
 * @param field - A parsed field. It need not belong to `collection` (the web app passes a field
 * with a substituted type).
 * @returns The display text.
 * @throws Only if given data that is not a validated collection.
 */
export function fieldTypeDisplay(
  collection: Collection,
  field: Field,
): string {
  return typeUseDisplay(collection, field.type);
}

/**
 * Shows a type use: a plain string type as written, or a definition reference displayed as
 * {@link definitionDisplay} does (a missing definition shows as `@id`). Published as Model's
 * `typeUseDisplay`. Pure: reads only.
 *
 * @param collection - A validated collection; references are resolved against it.
 * @param type - A parsed type use. It need not come from `collection`.
 * @returns The display text.
 * @throws Only if given data that is not a validated collection.
 */
export function typeUseDisplay(
  collection: Collection,
  type: TypeUse,
): string {
  if (typeof type === 'string') {
    return type;
  }
  return resolvedDefinitionDisplay(collection, type.id);
}

/**
 * Lists every direct use of a definition, sorted by path (`localeCompare`). Published as Model's
 * `definitionUsages`.
 *
 * Uses are: field and member types (`field` / `member`), signature parameter types
 * (`signature-parameter`, with the parameter's index) and returns (`signature-return`), all with
 * the object and block; and references inside other definitions' expressions (`definition`,
 * path only). Plain string types and uses of other definitions are not listed.
 *
 * Pure: reads only, so calling again gives the same list. Authoring owns correcting the
 * collection.
 *
 * @param collection - A validated collection.
 * @param id - The definition whose uses to list.
 * @returns The uses, or `validation-failed` with `not-found` at `definitions.<id>`, "Definition
 * ID must exist", when no definition has that ID. Not frozen.
 * @throws Only if given data that is not a validated collection.
 */
export function definitionUsages(
  collection: Collection,
  id: DefinitionId,
): Result<readonly DefinitionUsage[]> {
  const exists = collection.definitions.some(
    /** Tells whether this is the definition. */
    (definition) => definition.id === id,
  );
  if (!exists) {
    return failure('not-found', `definitions.${id}`, 'Definition ID must exist');
  }
  const fieldUses: DefinitionUsage[] = collection.objects.flatMap(
    /** Lists the uses in one object's content. */
    (object) =>
      object.content.flatMap(
        /** Lists the uses in one block. */
        (block) => usageForContent(block, object.id, id),
      ),
  );
  const definitionUses: DefinitionUsage[] = collection.definitions.flatMap(
    /** Lists the uses inside one definition's expression. */
    (definition) => definitionReferenceUsages(definition.expression, definition.id, id),
  );
  const uses = [...fieldUses, ...definitionUses];
  return success(
    uses.toSorted(
      /** Orders two uses by path. */
      (a, b) => a.path.localeCompare(b.path),
    ),
  );
}

/** The most nodes a definition expression may hold, and the most a display shows. */
const MAX_NODES = 256;

/** The deepest a definition expression may nest; the expression itself is depth 0. */
const MAX_DEPTH = 32;

/** An expression waiting to be checked against the limits. */
interface LimitFrame {
  /** The expression. */
  readonly expression: TypeExpression;
  /** Its collection path. */
  readonly path: string;
  /** Its nesting depth. */
  readonly depth: number;
}

/** How many expression nodes one limit check has visited. */
interface NodeCounter {
  /** Nodes visited so far. */
  visited: number;
}

/**
 * Checks one expression against the depth and node limits, depth-first (the last child is
 * visited first). Stops at the first problem and returns it alone.
 */
function expressionLimitIssues(
  expression: TypeExpression,
  path: string,
): readonly Diagnostic[] {
  const pending: LimitFrame[] = [{ expression, path, depth: 0 }];
  const counter: NodeCounter = { visited: 0 };
  let issue: Diagnostic | undefined;
  while (pending.length > 0) {
    issue = issue ?? visitLimitFrame(pending, counter);
  }
  if (issue === undefined) {
    return [];
  }
  return [issue];
}

/**
 * Visits the next pending expression: counts it, checks the limits, queues its union items, and
 * empties the queue when a limit is hit.
 */
function visitLimitFrame(
  pending: LimitFrame[],
  counter: NodeCounter,
): Diagnostic | undefined {
  const frame = pending.pop();
  if (frame === undefined) {
    return undefined;
  }
  counter.visited += 1;
  const issue = expressionLimit(frame.depth, counter.visited, frame.path);
  pushLimitChildren(frame, pending);
  if (issue !== undefined) {
    pending.length = 0;
  }
  return issue;
}

/** Returns the depth problem, else the node-count problem, else nothing. */
function expressionLimit(
  depth: number,
  nodes: number,
  path: string,
): Diagnostic | undefined {
  return depthLimit(depth, path) ?? nodeLimit(nodes, path);
}

/** Reports nesting deeper than {@link MAX_DEPTH}. */
function depthLimit(
  depth: number,
  path: string,
): Diagnostic | undefined {
  if (depth > MAX_DEPTH) {
    return { code: 'limit', path, message: 'Definition expression nesting exceeds the limit' };
  }
  return undefined;
}

/** Reports more than {@link MAX_NODES} nodes. */
function nodeLimit(
  nodes: number,
  path: string,
): Diagnostic | undefined {
  if (nodes > MAX_NODES) {
    return { code: 'limit', path, message: 'Definition expression is too large' };
  }
  return undefined;
}

/** Queues a union's items, in order, one level deeper. Other expressions have no children. */
function pushLimitChildren(
  frame: LimitFrame,
  pending: LimitFrame[],
): void {
  const expression = frame.expression;
  if (expression.kind !== 'union') {
    return;
  }
  expression.items.forEach(
    /** Queues one union item. */
    (item, index) =>
      pending.push({
        expression: item,
        path: `${frame.path}.items.${index}`,
        depth: frame.depth + 1,
      }),
  );
}

/** One definition reference found in an expression. */
interface ExpressionReference {
  /** The referenced definition. */
  readonly id: DefinitionId;
  /** The reference's collection path. */
  readonly path: string;
}

/** An expression waiting to be searched for references. */
interface ReferenceFrame {
  /** The expression. */
  readonly expression: TypeExpression;
  /** Its collection path. */
  readonly path: string;
}

/**
 * Lists every definition reference in an expression, depth-first (the last union item is
 * searched first).
 */
function expressionReferences(
  expression: TypeExpression,
  path: string,
): readonly ExpressionReference[] {
  const references: ExpressionReference[] = [];
  const pending: ReferenceFrame[] = [{ expression, path }];
  while (pending.length > 0) {
    visitReferenceFrame(pending, references);
  }
  return references;
}

/** Visits the next pending expression: records it if it is a reference, then queues its items. */
function visitReferenceFrame(
  pending: ReferenceFrame[],
  references: ExpressionReference[],
): void {
  const frame = pending.pop();
  if (frame === undefined) {
    return;
  }
  addReference(frame, references);
  pushReferenceChildren(frame, pending);
}

/** Records the expression when it is a definition reference. */
function addReference(
  frame: ReferenceFrame,
  references: ExpressionReference[],
): void {
  if (frame.expression.kind === 'reference') {
    references.push({ id: frame.expression.id, path: frame.path });
  }
}

/** Queues a union's items, in order. Other expressions have no children. */
function pushReferenceChildren(
  frame: ReferenceFrame,
  pending: ReferenceFrame[],
): void {
  const expression = frame.expression;
  if (expression.kind !== 'union') {
    return;
  }
  expression.items.forEach(
    /** Queues one union item. */
    (item, index) => pending.push({ expression: item, path: `${frame.path}.items.${index}` }),
  );
}

/** Checks each definition's limits, then that every reference in it names a definition. */
function validateDefinitions(collection: Collection): readonly Diagnostic[] {
  const definitionIds = collection.definitions.map(
    /** The definition's ID. */
    (definition) => definition.id,
  );
  const ids = new Set(definitionIds);
  return collection.definitions.flatMap(
    /** Checks one definition. */
    (definition) => {
      const path = `definitions.${definition.id}.expression`;
      const bounds = expressionLimitIssues(definition.expression, path);
      const unknown = expressionReferences(definition.expression, path).flatMap(
        /** Reports a reference to a missing definition. */
        (reference) => referenceIssue(!ids.has(reference.id), reference.path),
      );
      return [...bounds, ...unknown];
    },
  );
}

/**
 * A definition's visit state during the cycle search: 1 while it is on the current path, 2 once
 * finished. Unvisited definitions have no entry (read as 0).
 */
type VisitState = 0 | 1 | 2;

/** A definition on the current search path, and how many of its references were followed. */
interface GraphFrame {
  /** The definition. */
  readonly id: DefinitionId;
  /** The index of its next reference to follow. */
  index: number;
}

/**
 * Returns the definitions the cycle search marks: a depth-first search starts from each unvisited
 * definition in list order and, whenever a reference leads back to a definition on the current
 * path, marks every definition on that loop. Every cycle gets at least one marked definition, but
 * a definition on a cycle reached only through an already finished definition is not marked.
 * References to missing definitions are ignored.
 */
function cycleDefinitions(collection: Collection): ReadonlySet<DefinitionId> {
  const edges = collection.definitions.map(
    /** Pairs a definition with the IDs it references, in search order. */
    (definition): [DefinitionId, DefinitionId[]] => [
      definition.id,
      expressionReferences(definition.expression, `definitions.${definition.id}.expression`).map(
        /** The referenced ID. */
        (item) => item.id,
      ),
    ],
  );
  const adjacency = new Map(edges);
  const states = new Map<DefinitionId, VisitState>();
  const cycles = new Set<DefinitionId>();
  collection.definitions.forEach(
    /** Searches from one definition unless it was already visited. */
    (definition) => visitGraphRoot(definition.id, adjacency, states, cycles),
  );
  return cycles;
}

/** Runs the search from one unvisited definition until its path is empty. */
function visitGraphRoot(
  id: DefinitionId,
  adjacency: ReadonlyMap<DefinitionId, readonly DefinitionId[]>,
  states: Map<DefinitionId, VisitState>,
  cycles: Set<DefinitionId>,
): void {
  if (states.get(id) !== undefined) {
    return;
  }
  const stack: GraphFrame[] = [{ id, index: 0 }];
  states.set(id, 1);
  while (stack.length > 0) {
    visitGraphStep(stack, adjacency, states, cycles);
  }
}

/**
 * Follows the next reference of the definition on top of the path, or finishes that definition
 * when it has none left.
 */
function visitGraphStep(
  stack: GraphFrame[],
  adjacency: ReadonlyMap<DefinitionId, readonly DefinitionId[]>,
  states: Map<DefinitionId, VisitState>,
  cycles: Set<DefinitionId>,
): void {
  const frame = stack[stack.length - 1];
  if (frame === undefined) {
    return;
  }
  const target = (adjacency.get(frame.id) ?? [])[frame.index];
  if (target === undefined) {
    finishGraphFrame(stack, states, frame);
    return;
  }
  frame.index += 1;
  visitGraphTarget(target, stack, adjacency, states, cycles);
}

/** Marks a definition finished and removes it from the path. */
function finishGraphFrame(
  stack: GraphFrame[],
  states: Map<DefinitionId, VisitState>,
  frame: GraphFrame,
): void {
  states.set(frame.id, 2);
  stack.pop();
}

/** Handles one followed reference; a reference to a missing definition is ignored. */
function visitGraphTarget(
  target: DefinitionId,
  stack: GraphFrame[],
  adjacency: ReadonlyMap<DefinitionId, readonly DefinitionId[]>,
  states: Map<DefinitionId, VisitState>,
  cycles: Set<DefinitionId>,
): void {
  if (adjacency.get(target) === undefined) {
    return;
  }
  const state = targetState(states, target);
  visitGraphState(state, target, stack, states, cycles);
}

/**
 * Acts on a referenced definition's state: on the current path means a cycle; unvisited means
 * search it next; finished needs nothing.
 */
function visitGraphState(
  state: VisitState,
  target: DefinitionId,
  stack: GraphFrame[],
  states: Map<DefinitionId, VisitState>,
  cycles: Set<DefinitionId>,
): void {
  if (state === 1) {
    markCycle(stack, target, cycles);
  }
  if (state === 0) {
    descendGraph(target, stack, states);
  }
}

/** Returns a definition's visit state; one without an entry is unvisited (0). */
function targetState(
  states: ReadonlyMap<DefinitionId, VisitState>,
  target: DefinitionId,
): VisitState {
  return states.get(target) ?? 0;
}

/** Records every definition on the path from `target` to the top, and `target` itself. */
function markCycle(
  stack: readonly GraphFrame[],
  target: DefinitionId,
  cycles: Set<DefinitionId>,
): void {
  const start = stack.findIndex(
    /** Tells whether this path entry is the target. */
    (frame) => frame.id === target,
  );
  const cycleStart = Math.max(start, 0);
  stack.slice(cycleStart).forEach(
    /** Records one definition on the cycle. */
    (frame) => cycles.add(frame.id),
  );
  cycles.add(target);
}

/** Puts an unvisited definition on the path. */
function descendGraph(
  target: DefinitionId,
  stack: GraphFrame[],
  states: Map<DefinitionId, VisitState>,
): void {
  states.set(target, 1);
  stack.push({ id: target, index: 0 });
}

/** Reports each definition the cycle search marked (see `cycleDefinitions`), in definition order. */
function validateCycles(collection: Collection): readonly Diagnostic[] {
  const cycles = cycleDefinitions(collection);
  return collection.definitions.flatMap(
    /** Reports the definition if it is on a cycle. */
    (definition) =>
      diagnoseWhen(
        cycles.has(definition.id),
        'reference',
        `definitions.${definition.id}.expression`,
        'Definition references form a cycle',
      ),
  );
}

/** Checks that every definition reference in object content names a definition. */
function validateFieldTypes(collection: Collection): readonly Diagnostic[] {
  const definitionIds = collection.definitions.map(
    /** The definition's ID. */
    (definition) => definition.id,
  );
  const ids = new Set(definitionIds);
  return collection.objects.flatMap(
    /** Checks one object's content. */
    (object) =>
      object.content.flatMap(
        /** Checks one block's type uses. */
        (block) => validateContentTypes(block, object.id, ids),
      ),
  );
}

/** Checks a block's type uses: a signature's parameters and return, or a `type` field. */
function validateContentTypes(
  block: ContentBlock,
  object: ObjectId,
  ids: ReadonlySet<DefinitionId>,
): readonly Diagnostic[] {
  if (block.kind === 'signature') {
    return validateSignatureTypes(block, object, ids);
  }
  if ('type' in block) {
    return validateDirectType(block.type, object, block.id, ids);
  }
  return [];
}

/** Checks a field's or member's `type`. */
function validateDirectType(
  type: TypeUse,
  object: ObjectId,
  id: DescendantId,
  ids: ReadonlySet<DefinitionId>,
): readonly Diagnostic[] {
  return typeUseIssue(type, `${contentPath(object, id)}.type`, ids);
}

/** Checks each typed parameter of a signature, then its return type. */
function validateSignatureTypes(
  block: Extract<ContentBlock, { kind: 'signature' }>,
  object: ObjectId,
  ids: ReadonlySet<DefinitionId>,
): readonly Diagnostic[] {
  const parameters = block.parameters.flatMap(
    /** Checks one parameter. */
    (parameter, index) => validateParameterType(parameter, index, block, object, ids),
  );
  const returnIssues = typeUseIssue(block.returns, `${contentPath(object, block.id)}.returns`, ids);
  return [...parameters, ...returnIssues];
}

/** A signature parameter: a bare name, or a name with a type. */
type SignatureParameter = Extract<ContentBlock, { kind: 'signature' }>['parameters'][number];

/** Checks one parameter's type; a bare-name parameter has none. */
function validateParameterType(
  parameter: SignatureParameter,
  index: number,
  block: Extract<ContentBlock, { kind: 'signature' }>,
  object: ObjectId,
  ids: ReadonlySet<DefinitionId>,
): readonly Diagnostic[] {
  if (typeof parameter === 'string') {
    return [];
  }
  return typeUseIssue(
    parameter.type,
    `${contentPath(object, block.id)}.parameters.${index}.type`,
    ids,
  );
}

/** Reports a definition reference that names no definition; a plain string type is fine. */
function typeUseIssue(
  type: TypeUse,
  path: string,
  ids: ReadonlySet<DefinitionId>,
): readonly Diagnostic[] {
  if (typeof type === 'string') {
    return [];
  }
  return referenceIssue(!ids.has(type.id), path);
}

/** Writes a literal: strings JSON-quoted, numbers and booleans as text. */
function displayLiteral(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** How many more nodes one display may show, and whether it had to stop early. */
interface DisplayBudget {
  /** Nodes still allowed. */
  remaining: number;
  /** Set once a node could not be shown. */
  truncated: boolean;
}

/**
 * Shows one expression, spending one node of the budget. With the budget spent, it shows
 * nothing and marks the display truncated.
 */
function displayExpression(
  expression: TypeExpression,
  collection: Collection,
  seen: Set<DefinitionId>,
  budget: DisplayBudget,
): string {
  if (budget.remaining <= 0) {
    budget.truncated = true;
    return '';
  }
  budget.remaining -= 1;
  return displayKind(expression, collection, seen, budget);
}

/** Shows a union, or any other expression through its printer. */
function displayKind(
  expression: TypeExpression,
  collection: Collection,
  seen: Set<DefinitionId>,
  budget: DisplayBudget,
): string {
  if (expression.kind === 'union') {
    return displayUnion(expression.items, collection, seen, budget);
  }
  return displayNonUnion(expression, collection, seen, budget);
}

/** An expression that is not a union. */
type NonUnionExpression = Exclude<TypeExpression, { readonly kind: 'union' }>;

/** Each non-union expression type, by its `kind`. */
type ExpressionByKind = { [E in NonUnionExpression as E['kind']]: E };

/** One printer per non-union kind, each taking that kind's expression. */
type NonUnionPrinters = {
  readonly [K in keyof ExpressionByKind]: (
    expression: ExpressionByKind[K],
    collection: Collection,
    seen: Set<DefinitionId>,
    budget: DisplayBudget,
  ) => string;
};

/** Shows a non-union expression with the printer for its kind. */
function displayNonUnion<K extends keyof ExpressionByKind>(
  expression: ExpressionByKind[K] & { readonly kind: K },
  collection: Collection,
  seen: Set<DefinitionId>,
  budget: DisplayBudget,
): string {
  return nonUnionPrinters[expression.kind](expression, collection, seen, budget);
}

/** The printers: a primitive by name, a literal as text, a reference expanded. */
const nonUnionPrinters: NonUnionPrinters = {
  /** Shows a primitive type by name. */
  primitive: (expression) => expression.name,
  /** Shows a literal as text. */
  literal: (expression) => displayLiteral(expression.value),
  /** Expands a reference to another definition. */
  reference: (expression, collection, seen, budget) =>
    displayReference(expression.id, collection, seen, budget),
};

/**
 * Shows union items joined with ` | ` while budget remains. Items not reached mark the display
 * truncated; empty parts are dropped.
 */
function displayUnion(
  items: readonly TypeExpression[],
  collection: Collection,
  seen: Set<DefinitionId>,
  budget: DisplayBudget,
): string {
  const parts: string[] = [];
  let index = 0;
  while (index < items.length && budget.remaining > 0) {
    const item = unionItem(items, index);
    parts.push(displayExpression(item, collection, seen, budget));
    index += 1;
  }
  markTruncated(budget, index, items.length);
  const shownParts = parts.filter(
    /** Keeps parts that show something. */
    (part) => part.length > 0,
  );
  return shownParts.join(' | ');
}

/**
 * Returns the union item at `index`. A validated union has no missing items; for a missing one it
 * throws the same TypeError that reading the item's `kind` would.
 */
function unionItem(
  items: readonly TypeExpression[],
  index: number,
): TypeExpression {
  const item = items[index];
  if (item === undefined) {
    throw new TypeError("Cannot read properties of undefined (reading 'kind')");
  }
  return item;
}

/** Marks the display truncated when items remain but the budget is spent. */
function markTruncated(
  budget: DisplayBudget,
  index: number,
  length: number,
): void {
  if (index < length && budget.remaining <= 0) {
    budget.truncated = true;
  }
}

/**
 * Expands a reference. One already being expanded on this path, or to a missing definition,
 * shows as `@id`. Each expansion gets its own copy of `seen`.
 */
function displayReference(
  id: DefinitionId,
  collection: Collection,
  seen: Set<DefinitionId>,
  budget: DisplayBudget,
): string {
  if (seen.has(id)) {
    return `@${id}`;
  }
  const target = collection.definitions.find(
    /** Tells whether this is the referenced definition. */
    (definition) => definition.id === id,
  );
  if (target === undefined) {
    return `@${id}`;
  }
  const next = new Set(seen);
  next.add(id);
  return displayExpression(target.expression, collection, next, budget);
}

/**
 * Shows one definition with a fresh budget of {@link MAX_NODES} nodes, adding ` …` when it was
 * cut short. A missing definition shows as `@id`.
 */
function resolvedDefinitionDisplay(
  collection: Collection,
  id: DefinitionId,
): string {
  const definition = collection.definitions.find(
    /** Tells whether this is the definition. */
    (item) => item.id === id,
  );
  if (definition === undefined) {
    return `@${id}`;
  }
  const budget = { remaining: MAX_NODES, truncated: false };
  const display = displayExpression(definition.expression, collection, new Set([id]), budget);
  if (budget.truncated) {
    return `${display} …`;
  }
  return display;
}

/** Lists the references to `id` inside one definition's expression, as `definition` uses. */
function definitionReferenceUsages(
  expression: TypeExpression,
  owner: DefinitionId,
  id: DefinitionId,
): readonly DefinitionUsage[] {
  const matching = expressionReferences(expression, `definitions.${owner}.expression`).filter(
    /** Tells whether this reference names the definition. */
    (reference) => reference.id === id,
  );
  return matching.map(
    /** Describes one use. */
    (reference): DefinitionReferenceUsage => ({
      kind: 'definition',
      definition: id,
      path: reference.path,
    }),
  );
}

/** Lists a block's uses of `id`: a signature's parameters and return, or a `type` field. */
function usageForContent(
  block: ContentBlock,
  object: ObjectId,
  id: DefinitionId,
): readonly DefinitionUsage[] {
  if (block.kind === 'signature') {
    return signatureUsages(block, object, id);
  }
  if ('type' in block) {
    return directUsage(block, object, id, block.kind);
  }
  return [];
}

/** Lists a field's or member's use of `id` in its `type`. */
function directUsage(
  block: Extract<ContentBlock, { kind: 'field' | 'member' }>,
  object: ObjectId,
  id: DefinitionId,
  kind: 'field' | 'member',
): readonly DefinitionUsage[] {
  return contentTypeUsage(
    block.type,
    `${contentPath(object, block.id)}.type`,
    kind,
    object,
    id,
    block.id,
  );
}

/** Lists a signature's uses of `id`: each typed parameter, then the return type. */
function signatureUsages(
  block: Extract<ContentBlock, { kind: 'signature' }>,
  object: ObjectId,
  id: DefinitionId,
): readonly DefinitionUsage[] {
  const parameters = block.parameters.flatMap(
    /** Lists one parameter's use. */
    (parameter, index) => parameterUsage(parameter, index, block, object, id),
  );
  const returnUses = contentTypeUsage(
    block.returns,
    `${contentPath(object, block.id)}.returns`,
    'signature-return',
    object,
    id,
    block.id,
  );
  return [...parameters, ...returnUses];
}

/** Lists one parameter's use of `id`; a bare-name parameter has no type. */
function parameterUsage(
  parameter: SignatureParameter,
  index: number,
  block: Extract<ContentBlock, { kind: 'signature' }>,
  object: ObjectId,
  id: DefinitionId,
): readonly DefinitionUsage[] {
  if (typeof parameter === 'string') {
    return [];
  }
  return parameterTypeUsage(
    parameter.type,
    `${contentPath(object, block.id)}.parameters.${index}.type`,
    object,
    id,
    block.id,
    index,
  );
}

/** Returns a content block's collection path, `objects.<object>.content.<block>`. */
function contentPath(
  object: ObjectId,
  block: DescendantId,
): string {
  return `objects.${object}.content.${block}`;
}

/** Tells whether a type use is a reference to the definition (a plain string type never is). */
function referencesDefinition(
  type: TypeUse,
  id: DefinitionId,
): boolean {
  return typeof type !== 'string' && type.id === id;
}

/**
 * Returns one content use when the type references `id`, else none. Fields in this order:
 * `kind`, `definition`, `path`, `object`, `field`.
 */
function contentTypeUsage(
  type: TypeUse,
  path: string,
  kind: ContentTypeUsage['kind'],
  object: ObjectId,
  id: DefinitionId,
  field: DescendantId,
): readonly DefinitionUsage[] {
  if (!referencesDefinition(type, id)) {
    return [];
  }
  return [{ kind, definition: id, path, object, field }];
}

/**
 * Returns one parameter use when the type references `id`, else none. Fields in this order:
 * `kind`, `definition`, `path`, `object`, `field`, `parameter`.
 */
function parameterTypeUsage(
  type: TypeUse,
  path: string,
  object: ObjectId,
  id: DefinitionId,
  field: DescendantId,
  parameter: number,
): readonly DefinitionUsage[] {
  if (!referencesDefinition(type, id)) {
    return [];
  }
  return [{ kind: 'signature-parameter', definition: id, path, object, field, parameter }];
}
