import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import type { WorkspaceId } from '../contract/brands.js';
import { randomUUID } from 'node:crypto';
import type { DatabasePort, PartsPort } from '../contract/ports/database.js';
import type { StorePort, Decision } from '../contract/ports/store.js';

/**
 * Creates the storage seam over one SQLite database for one workspace.
 *
 * Each `transact` call runs one SQLite transaction:
 * 1. `BEGIN IMMEDIATE`, so receipt lookups and version checks are serialized with writes from
 *    every connection.
 * 2. Read the stored envelope. When the database's data version shows nothing changed since this
 *    store's last read or write, the text already held is reused.
 * 3. Decode it (a missing row decodes as an empty workspace) and pass it to `decide`. A decode
 *    failure, or a throw from `decide`, is `corrupt-record`; malformed content is never reset.
 *    A driver throw while reading item rows (`parts.get`) happens during decoding, so it is
 *    `corrupt-record` too, not `storage-unavailable`.
 * 4. A failed decision is rolled back. A decision that returns the state it read commits without
 *    writing. Otherwise the new envelope is written, then committed.
 * 5. Any other throw (BEGIN, reading the version or row, encoding, writing, COMMIT) is rolled back
 *    and reported as `storage-unavailable`: the outcome is uncertain, so Authoring must reopen and
 *    reconcile the request receipt.
 * 6. A ROLLBACK that itself throws returns `storage-unavailable`, "Rollback could not be
 *    confirmed", in place of the result being rolled back.
 *
 * When the port has `parts`, top-level arrays of objects (slots, receipts) are stored one row per
 * item, and a commit writes only items not stored before. The adapter holds no document policy.
 *
 * @param database - The prepared database port.
 * @param workspace - The workspace a missing row is created for.
 * @returns The store. `close` closes the database; later operations fail with
 * `storage-unavailable`.
 */
export function createSqliteStore(
  database: DatabasePort,
  workspace: WorkspaceId,
): StorePort {
  const last: Decoded = {
    text: null,
    value: undefined,
    version: undefined,
    items: new Map(),
    ids: new WeakMap(),
  };
  return {
    transact: (decide) => transact(database, workspace, last, decide),
    close: () => closeDatabase(database),
  };
}

/**
 * The last stored text this store read or wrote, and what it decoded to. Unchanged text returns
 * the same object, so callers can cache on its identity.
 */
interface Decoded {
  text: string | null;
  value: unknown;
  version: unknown;
  /** Item rows in the current head: id → parsed item and its stored text. */
  items: Map<string, Item>;
  /** Items already stored, by object identity, so a commit skips re-serializing them. */
  ids: WeakMap<object, string>;
}

/** One stored item row: its parsed value and the exact text it was stored as. */
interface Item {
  readonly value: unknown;
  readonly body: string;
}

/** Head key listing which top-level arrays are stored as item rows. */
const PARTS = '$parts';

/** Runs one decision inside `BEGIN IMMEDIATE … COMMIT`; any throw is rolled back as uncertain. */
function transact<T>(
  database: DatabasePort,
  workspace: WorkspaceId,
  last: Decoded,
  decide: (raw: unknown) => Result<Decision<T>>,
): Result<T> {
  try {
    database.exec('BEGIN IMMEDIATE');
    return installDecision(database, last, readDecision(database, workspace, last, decide));
  } catch {
    return rollback(
      database,
      fail('storage-unavailable', '$', 'Transaction outcome requires receipt reconciliation'),
    );
  }
}

/**
 * Reads and decodes the stored envelope and passes it to `decide`. A decode failure (or a throw
 * from `decide`) is `corrupt-record`; the caller rolls back without replacing the row.
 */
function readDecision<T>(
  database: DatabasePort,
  workspace: WorkspaceId,
  last: Decoded,
  decide: (raw: unknown) => Result<Decision<T>>,
): Result<Decision<T>> {
  const stored = currentStoredText(database, last);
  try {
    return decide(decodeStored(stored, workspace, last, database.parts));
  } catch {
    return fail('corrupt-record', '$', 'Stored envelope cannot be decoded safely');
  }
}

/**
 * The stored text: the text already held when no other connection has committed since this
 * store's last read or write, otherwise a fresh read. Records the data version it saw.
 */
function currentStoredText(
  database: DatabasePort,
  last: Decoded,
): unknown {
  const version = database.version?.();
  const current = last.text !== null && version !== undefined && version === last.version;
  const stored = current ? last.text : database.read();
  last.version = version;
  return stored;
}

/**
 * Stores a successful decision and commits; rolls back a failed one.
 * A decision that hands back the state it read commits without writing.
 */
function installDecision<T>(
  database: DatabasePort,
  last: Decoded,
  decision: Result<Decision<T>>,
): Result<T> {
  if (!decision.ok) {
    return rollback(database, decision);
  }
  // Reads hand back the state they read: nothing to write.
  if (decision.value.state === last.value) {
    database.exec('COMMIT');
    return { ok: true, value: decision.value.value };
  }
  const { text, items } = encode(decision.value.state, last, database.parts);
  database.write(text);
  database.exec('COMMIT');
  Object.assign(last, { text, value: decision.value.state, items });
  return { ok: true, value: decision.value.value };
}

/**
 * Rolls back the open transaction and returns `result`. When the rollback itself fails the
 * outcome is uncertain: `storage-unavailable`, and Authoring reconciles the receipt after reopen.
 */
function rollback<T>(
  database: DatabasePort,
  result: Result<T>,
): Result<T> {
  try {
    database.exec('ROLLBACK');
    return result;
  } catch {
    return fail(
      'storage-unavailable',
      '$',
      'Rollback could not be confirmed; reopen and reconcile',
    );
  }
}

/** Closes the database; a failed close is `storage-unavailable`. */
function closeDatabase(database: DatabasePort): Result<void> {
  try {
    database.close();
    return { ok: true, value: undefined };
  } catch {
    return fail('storage-unavailable', '$', 'Database close failed; reopen before retry');
  }
}

/**
 * Decodes the stored value. Only a missing row (`undefined`) becomes an empty workspace. Text is
 * parsed (text that is not JSON throws); the parsed value, valid or not, is passed on for
 * validation and never reset. A non-string value is passed on as is.
 */
function decodeStored(
  serialized: unknown,
  workspace: WorkspaceId,
  last: Decoded,
  parts: PartsPort | undefined,
): unknown {
  if (serialized === undefined) {
    return { schemaVersion: 1, workspace, sequence: 0, slots: [], receipts: [] };
  }
  if (typeof serialized !== 'string') {
    return serialized;
  }
  return decodeText(serialized, last, parts);
}

/**
 * Parses stored text, assembling item rows when the head lists them. Text equal to the last text
 * returns the same object as last time.
 *
 * @throws SyntaxError for text that is not JSON, and Error when listed item rows are missing or
 * malformed.
 */
function decodeText(
  serialized: string,
  last: Decoded,
  parts: PartsPort | undefined,
): unknown {
  if (serialized === last.text) {
    return last.value;
  }
  const parsed: unknown = JSON.parse(serialized);
  const value = listsParts(parsed) ? assemble(parsed, last, parts) : parsed;
  Object.assign(last, { text: serialized, value });
  return value;
}

/** True for a parsed head that lists item rows under {@link PARTS}. */
function listsParts(parsed: unknown): parsed is Record<string, unknown> {
  return isRecord(parsed) && PARTS in parsed;
}

/** True for a plain object; arrays and `null` are not. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds the envelope from its head: each listed array of item ids becomes the array of items.
 * Items whose id was loaded last time are reused; the rest are loaded from their rows.
 *
 * @throws Error when there is no parts port, or the head's item lists or ids are malformed, or a
 * row is missing; SyntaxError when a loaded row is not JSON.
 */
function assemble(
  head: Record<string, unknown>,
  last: Decoded,
  parts: PartsPort | undefined,
): unknown {
  const listed = listedParts(head, parts);
  const items = new Map<string, Item>();
  const out: Record<string, unknown> = { ...head };
  delete out[PARTS];
  for (const key of listed.keys) {
    const { name, ids } = listedIds(head, key);
    out[name] = ids.map((id) => assembleItem(id, last, listed.parts, items));
  }
  last.items = items;
  return out;
}

/** The head's list of item-row arrays, and the parts port. Throws when either is unavailable. */
function listedParts(
  head: Record<string, unknown>,
  parts: PartsPort | undefined,
): { readonly keys: readonly unknown[]; readonly parts: PartsPort } {
  const keys = head[PARTS];
  if (parts === undefined || !Array.isArray(keys)) {
    throw new Error('item rows unavailable');
  }
  return { keys, parts };
}

/** The field name and its array of item ids. Throws when the name or the ids are malformed. */
function listedIds(
  head: Record<string, unknown>,
  key: unknown,
): { readonly name: string; readonly ids: unknown[] } {
  if (typeof key !== 'string') {
    throw new Error('item ids malformed');
  }
  const ids = head[key];
  if (!Array.isArray(ids)) {
    throw new Error('item ids malformed');
  }
  return { name: key, ids };
}

/**
 * One item of an assembled array: reused from last time or loaded from its row, recorded in the
 * new item map, and remembered by identity.
 */
function assembleItem(
  id: unknown,
  last: Decoded,
  parts: PartsPort,
  items: Map<string, Item>,
): unknown {
  if (typeof id !== 'string') {
    throw new Error('item id malformed');
  }
  const item = last.items.get(id) ?? load(parts, id);
  items.set(id, item);
  rememberId(last, item.value, id);
  return item.value;
}

/** Remembers the id an object value is stored under, so a later commit reuses its row. */
function rememberId(
  last: Decoded,
  value: unknown,
  id: string,
): void {
  if (typeof value === 'object' && value !== null) {
    last.ids.set(value, id);
  }
}

/** Loads and parses one item row. Throws when the row is missing or not JSON. */
function load(
  parts: PartsPort,
  id: string,
): Item {
  const body = parts.get(id);
  if (body === undefined) {
    throw new Error('item row missing');
  }
  const value: unknown = JSON.parse(body);
  return { value, body };
}

/**
 * Encodes a state for storage: the head text, plus the item rows it lists.
 *
 * Without a parts port, or for a state that is not a plain object, the whole state is one JSON
 * text and there are no item rows.
 */
function encode(
  state: unknown,
  last: Decoded,
  parts: PartsPort | undefined,
): { text: string; items: Map<string, Item> } {
  if (parts === undefined || !isRecord(state)) {
    return { text: JSON.stringify(state), items: new Map() };
  }
  return encodeWithParts(state, last, parts);
}

/**
 * Encodes a state with item rows.
 *
 * Each top-level array whose entries are all objects is stored as a list of item ids, and the
 * head lists those fields under {@link PARTS}. Only items not stored before get a new row; rows
 * the new head no longer lists are removed afterwards.
 */
function encodeWithParts(
  state: Record<string, unknown>,
  last: Decoded,
  parts: PartsPort,
): { text: string; items: Map<string, Item> } {
  const items = new Map<string, Item>();
  const find = itemIdFinder(last, parts, items);
  const head: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const [key, value] of Object.entries(state)) {
    head[key] = encodeField(key, value, keys, find);
  }
  head[PARTS] = keys;
  removeUnlistedRows(last, items, parts);
  return { text: JSON.stringify(head), items };
}

/**
 * The head value for one field: the list of item ids for an array of objects (and the field is
 * added to `keys`), otherwise the value itself.
 */
function encodeField(
  key: string,
  value: unknown,
  keys: string[],
  find: (item: object) => string,
): unknown {
  if (!isItemList(value)) {
    return value;
  }
  keys.push(key);
  return value.map(find);
}

/** True for an array whose entries are all objects (an empty array counts). */
function isItemList(value: unknown): value is readonly object[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null);
}

/**
 * Returns the function that gives each item its row id during one encode, and records it in
 * `items`.
 *
 * 1. An object stored before, whose row the current head still lists, keeps its id.
 * 2. Otherwise an existing row with the same text is reused.
 * 3. Otherwise a new row is written under a new random id.
 */
function itemIdFinder(
  last: Decoded,
  parts: PartsPort,
  items: Map<string, Item>,
): (item: object) => string {
  const idsByBody = lazyIdsByBody(last);
  return (item) => {
    const known = storedBefore(last, item);
    if (known !== undefined) {
      items.set(known.id, known.stored);
      return known.id;
    }
    return storeItem(item, last, parts, items, idsByBody);
  };
}

/** The id and stored row of an object stored before, when the current head still lists it. */
function storedBefore(
  last: Decoded,
  item: object,
): { id: string; stored: Item } | undefined {
  const id = last.ids.get(item);
  if (id === undefined) {
    return undefined;
  }
  const stored = last.items.get(id);
  if (stored === undefined) {
    return undefined;
  }
  return { id, stored };
}

/** Gives an item the id of an existing row with the same text, or writes it under a new id. */
function storeItem(
  item: object,
  last: Decoded,
  parts: PartsPort,
  items: Map<string, Item>,
  idsByBody: () => Map<string, string>,
): string {
  const body = JSON.stringify(item);
  const same = idsByBody().get(body);
  const id = same ?? randomUUID();
  if (same === undefined) {
    parts.put(id, body);
  }
  items.set(id, { value: item, body });
  last.ids.set(item, id);
  return id;
}

/** Builds the text → id map of the current rows on first use only, then returns the same map. */
function lazyIdsByBody(last: Decoded): () => Map<string, string> {
  let idsByBody: Map<string, string> | null = null;
  return () => {
    idsByBody ??= new Map([...last.items].map(([id, stored]) => [stored.body, id]));
    return idsByBody;
  };
}

/** Removes the rows of the current head that the new head no longer lists, in stored order. */
function removeUnlistedRows(
  last: Decoded,
  items: Map<string, Item>,
  parts: PartsPort,
): void {
  const unlisted = [...last.items.keys()].filter((id) => !items.has(id));
  unlisted.forEach((id) => parts.remove(id));
}
