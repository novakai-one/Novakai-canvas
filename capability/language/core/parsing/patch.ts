/*
 * Reading patch operations, such as `set node @a label="New"` or `show @a in @flow`. Each action
 * word has its own small grammar; no operation takes an arbitrary nested path. Checking the
 * operation against the collection is later work (see core/patching). Language owns correcting
 * the source; Authoring owns commit recovery.
 */
import type {
  Operation,
  TargetKind,
  Action,
  Construct,
  Declaration,
  Fields,
  Reference,
} from '../../contract/records/syntax.js';
import type { Property } from '../../contract/records/vocabulary.js';
import { patchProperties, operationWords } from '../vocabulary/patch-properties.js';
import { membershipActions } from '../vocabulary/defaults.js';
import { reject, accepted } from '../validation/outcomes.js';
import {
  peek,
  advance,
  consume,
  enter,
  leave,
  consumedSpan,
  type Cursor,
  type Parsed,
} from './cursor.js';
import { readIdentity, readReference } from './references.js';
import { reference } from '../lowering/fields.js';
import { readAttributes } from './attributes.js';
import { readDeclaration } from './declarations.js';
import { repeat } from './repetition.js';

/** Reads one operation starting at its action word. */
type Reader = (cursor: Cursor) => Parsed<Operation>;

/** A record that `add` or `replace` writes as a whole declaration. */
type DeclarationTarget = 'node' | 'wire' | 'asset' | 'source' | 'section';

/** What `add` may add as a whole declaration. */
const addTargets: readonly DeclarationTarget[] = ['node', 'wire', 'asset', 'source', 'section'];

/** What `replace` may replace. */
const replaceTargets: readonly DeclarationTarget[] = ['node', 'section'];

/** What `set` and `unset` may change. */
const propertyTargets: readonly TargetKind[] = [
  'collection',
  'node',
  'wire',
  'block',
  'appearance',
  'section',
  'route',
];

/** What `delete` may delete. */
const deleteTargets: readonly TargetKind[] = ['node', 'wire', 'section', 'asset', 'source'];

/** What `reset` may reset. */
const resetTargets: readonly TargetKind[] = ['layout', 'route'];

/** The block constructs `add block` may add. */
const blockConstructs: readonly Construct[] = [
  'text',
  'code',
  'link',
  'list',
  'image',
  'icon',
  'field',
  'keygroup',
  'signature',
  'member',
  'table',
];

/** The parts of an operation record; the omitted ones default as in {@link operation}. */
interface OperationParts {
  /** The action word. */
  readonly action: Action;

  /** What kind of record the operation addresses. */
  readonly target: TargetKind;

  /** The record addressed. */
  readonly address: Reference;

  /** The attributes written; defaults to none. */
  readonly fields?: Fields;

  /** The declaration written by `add` or `replace`; defaults to `null`. */
  readonly declaration?: Declaration | null;

  /** The property names given to `unset`; defaults to none. */
  readonly properties?: readonly string[];
}

/**
 * Reads one patch operation.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic for an unknown action word, an unknown
 * target, a declaration without an ID, or a `set`/`unset` without properties; and every fault
 * from reading references, attributes and declarations.
 */
export function readOperation(cursor: Cursor): Parsed<Operation> {
  const reader = readers[peek(cursor).text];
  if (reader === undefined)
    reject('syntax', peek(cursor).span, operationWords.join(' / '), 'Unknown patch operation');
  return reader(cursor);
}

/** The reader for each action word. */
const readers: Readonly<Record<string, Reader>> = {
  add: readAdd,
  replace: readReplace,
  set: readSet,
  unset: readUnset,
  show: readMembership,
  hide: readMembership,
  connect: readMembership,
  disconnect: readMembership,
  delete: readDelete,
  reset: readReset,
  remove: readBlockMove,
  move: readBlockMove,
};

/** `add block @object { … }`, or `add` of a whole node, wire, asset, source or section. */
function readAdd(cursor: Cursor): Parsed<Operation> {
  if (peek(cursor, 1).text === 'block') return readAddBlock(cursor);
  return readDeclarationOperation(cursor, 'add', addTargets);
}

/**
 * `add block @object { declaration } before=@block`: one content block, optionally placed
 * before another block of the same object.
 */
function readAddBlock(cursor: Cursor): Parsed<Operation> {
  const address = readReference(advance(cursor, 2));
  const start = enter(consume(address.next, '{'));
  const child = readDeclaration(start, blockConstructs);
  const end = leave(consume(child.next, '}'));
  const fields = readAttributes(end, { before: { type: 'id', field: 'before' } });
  return operation(cursor, fields.next, {
    action: 'add',
    target: 'block',
    address: reference(address.value),
    fields: fields.value,
    declaration: child.value,
  });
}

/** `replace node …` or `replace section …`: a complete declaration with the same ID. */
function readReplace(cursor: Cursor): Parsed<Operation> {
  return readDeclarationOperation(cursor, 'replace', replaceTargets);
}

/**
 * `add` or `replace` with a whole declaration. The declaration's own ID is the address; no
 * second ID is read.
 */
function readDeclarationOperation(
  cursor: Cursor,
  action: 'add' | 'replace',
  allowed: readonly DeclarationTarget[],
): Parsed<Operation> {
  const start = advance(cursor);
  const target = targetKind(start, allowed);
  const declaration = readDeclaration(start, allowed);
  const identity = declaration.value.fields.id;
  if (identity === undefined)
    reject('syntax', peek(start).span, 'Declaration ID', 'Declaration has no ID');
  return operation(cursor, declaration.next, {
    action,
    target,
    address: reference(identity),
    fields: {},
    declaration: declaration.value,
  });
}

/**
 * `set target @address name=value …`: at least one attribute, from the target's patch
 * vocabulary. Whether a block property suits the block's kind is checked later.
 */
function readSet(cursor: Cursor): Parsed<Operation> {
  const target = readTarget(advance(cursor));
  const fields = readAttributes(target.next, patchProperties[target.value.target]);
  if (Object.keys(fields.value).length === 0)
    reject(
      'syntax',
      peek(fields.next).span,
      'One or more named assignments',
      'Set requires properties',
    );
  return operation(cursor, fields.next, {
    action: 'set',
    target: target.value.target,
    address: target.value.address,
    fields: fields.value,
  });
}

/**
 * `unset target @address name …`: at least one property name, read up to the next action word
 * or `}`.
 */
function readUnset(cursor: Cursor): Parsed<Operation> {
  const target = readTarget(advance(cursor));
  const properties = accepted(repeat(target.next, continuesProperty, readPropertyName));
  if (properties.value.length === 0)
    reject(
      'syntax',
      peek(target.next).span,
      'One or more property names',
      'Unset requires properties',
    );
  return operation(cursor, properties.next, {
    action: 'unset',
    target: target.value.target,
    address: target.value.address,
    fields: {},
    declaration: null,
    properties: properties.value,
  });
}

/**
 * The target word and address of `set` or `unset`. `collection` has no address (the patch header
 * names the collection), so its address ID is empty.
 */
function readTarget(
  cursor: Cursor,
): Parsed<{ readonly target: TargetKind; readonly address: Reference }> {
  const target = targetKind(cursor, propertyTargets);
  if (target === 'collection')
    return { value: { target, address: { kind: 'reference', id: '' } }, next: advance(cursor) };
  const address = readReference(advance(cursor));
  return { value: { target, address: reference(address.value) }, next: address.next };
}

/** Whether another property name follows: a word that is not an action word. */
function continuesProperty(cursor: Cursor): boolean {
  return peek(cursor).kind === 'word' && !operationWords.includes(peek(cursor).text);
}

/** Reads one property name as written. */
function readPropertyName(cursor: Cursor): Parsed<string> {
  return { value: peek(cursor).text, next: advance(cursor) };
}

/** `show @item in @section` (and `hide`, `connect`, `disconnect`): both IDs are always written. */
function readMembership(cursor: Cursor): Parsed<Operation> {
  const action = membershipActions.find((item) => item === peek(cursor).text);
  const item = readIdentity(advance(cursor));
  const section = readIdentity(consume(item.next, 'in'));
  if (action !== 'show' && action !== 'hide' && action !== 'connect' && action !== 'disconnect')
    reject('syntax', peek(cursor).span, 'Membership action', 'Invalid membership action');
  return operation(cursor, section.next, {
    action,
    target: 'section',
    address: {
      kind: 'reference',
      id: item.value,
      section: section.value,
    },
  });
}

/**
 * `delete target @address`. Only a node takes an attribute, `cascade=true`, to delete what
 * depends on it; other deletes keep the dependency checks.
 */
function readDelete(cursor: Cursor): Parsed<Operation> {
  const target = targetKind(advance(cursor), deleteTargets);
  const address = readReference(advance(cursor, 2));
  const properties = deleteProperties(target);
  const attributes = readAttributes(address.next, properties);
  return operation(cursor, attributes.next, {
    action: 'delete',
    target,
    address: reference(address.value),
    fields: attributes.value,
  });
}

/** The attributes `delete` accepts: `cascade` for a node, none otherwise. */
function deleteProperties(target: TargetKind): Readonly<Record<string, Property>> {
  if (target === 'node') return { cascade: { type: 'boolean', field: 'cascade' } };
  return {};
}

/** `reset layout @address` or `reset route @address`. */
function readReset(cursor: Cursor): Parsed<Operation> {
  const target = targetKind(advance(cursor), resetTargets);
  const address = readReference(advance(cursor, 2));
  return operation(cursor, address.next, {
    action: 'reset',
    target,
    address: reference(address.value),
  });
}

/**
 * `move block @object.@block before=@other` or `remove block @object.@block`. A `move` without
 * `before` is read here; patching rejects it.
 */
function readBlockMove(cursor: Cursor): Parsed<Operation> {
  const action = blockAction(cursor);
  const start = consume(advance(cursor), 'block');
  const address = readReference(start);
  const properties = blockMoveProperties(action);
  const fields = readAttributes(address.next, properties);
  return operation(cursor, fields.next, {
    action,
    target: 'block',
    address: reference(address.value),
    fields: fields.value,
  });
}

/** `move` when the action word is `move`; otherwise `remove`. */
function blockAction(cursor: Cursor): 'move' | 'remove' {
  if (peek(cursor).text === 'move') return 'move';
  return 'remove';
}

/**
 * The attributes a block action accepts: `before` for `move`, none for `remove`. Patching, not
 * the parser, requires `before`.
 */
function blockMoveProperties(action: 'move' | 'remove'): Readonly<Record<string, Property>> {
  if (action === 'move') return { before: { type: 'id', field: 'before' } };
  return {};
}

/** The target word at the cursor; it must be one of `allowed`. */
function targetKind(
  cursor: Cursor,
  allowed: readonly TargetKind[],
): TargetKind {
  const kind = allowed.find((item) => item === peek(cursor).text);
  if (kind === undefined)
    reject('syntax', peek(cursor).span, allowed.join(' / '), 'Unknown operation target');
  return kind;
}

/**
 * Builds an operation record spanning from `start` to `end`. Left out, `fields` is `{}`,
 * `declaration` is `null` and `properties` is `[]`.
 */
function operation(
  start: Cursor,
  end: Cursor,
  parts: OperationParts,
): Parsed<Operation> {
  const { action, target, address, fields = {}, declaration = null, properties = [] } = parts;
  return {
    value: {
      action,
      target,
      address,
      fields,
      declaration,
      properties,
      span: consumedSpan(start, end),
    },
    next: end,
  };
}
