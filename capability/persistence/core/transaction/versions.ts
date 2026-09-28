import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { ReadVersion, Slot, WorkspaceState } from '../../contract/records/storage.js';
import type { Write } from '../../contract/records/transaction.js';
import { findSlot, keyText } from './keys.js';
import { success } from '../validation/outcomes.js';

/** A write that creates a slot: a put or a delete. Purges create none. */
export type SlotWrite = Write & { readonly kind: 'put' | 'delete' };

/**
 * Checks that every version the author observed is still current.
 *
 * The list covers records the request only read, as well as the records it writes. Entries are
 * checked in order and the first mismatch is reported.
 *
 * @param state - The workspace state the commit would apply to.
 * @param expected - The versions the author observed.
 * @returns Success, or `revision-conflict` with the first mismatched record's `kind/id` as the
 * path.
 */
export function compareVersions(
  state: WorkspaceState,
  expected: readonly ReadVersion[],
): Result<void> {
  const mismatch = expected.find((read) => currentVersion(state, read.key) !== read.version);
  if (mismatch) {
    return fail('revision-conflict', keyText(mismatch.key), 'Observed version changed');
  }
  return success(undefined);
}

/**
 * Checks each write is allowed before any new slot is built.
 *
 * The rules run in this order, and the first rule that any write breaks is reported:
 * 1. A delete must target a live record: `Delete requires a live record`.
 * 2. A purge must target a stored record, live or tombstoned: `Purge requires a stored record`.
 * 3. No write (put, delete or purge) may target a record already at `Number.MAX_SAFE_INTEGER`:
 *    `Record version exhausted`.
 *
 * @param state - The workspace state the commit would apply to.
 * @param writes - The request's writes.
 * @returns Success, or `invalid-input` with path `writes` and the broken rule's message.
 */
export function checkWrites(
  state: WorkspaceState,
  writes: readonly Write[],
): Result<void> {
  const broken = writeRules.find((rule) => anyWriteBreaks(rule, state, writes));
  if (broken) {
    return fail('invalid-input', 'writes', broken.message);
  }
  return success(undefined);
}

/**
 * Builds the new slot for a put or a delete.
 *
 * Each put or delete creates a new version: 0 for a record that is absent, otherwise the current version
 * plus one. A delete becomes a tombstone with a `null` value and no resources. The payload's own
 * revision field is Authoring's responsibility and is not touched here.
 *
 * Purges do not create slots; the commit filters them out before calling this.
 *
 * @param state - The workspace state before the commit.
 * @param write - A put or delete write.
 * @returns The new slot. A put reuses the write's `key`, `value` and `resources` by reference.
 */
export function writeSlot(
  state: WorkspaceState,
  write: SlotWrite,
): Slot {
  const previousVersion = currentVersion(state, write.key);
  const version = previousVersion === 'absent' ? 0 : previousVersion + 1;
  if (write.kind !== 'put') {
    return { key: write.key, version, value: null, deleted: true, resources: [] };
  }
  return {
    key: write.key,
    version,
    value: write.value,
    deleted: false,
    resources: write.resources,
  };
}

/**
 * Gives a record's current version token.
 *
 * A record that was never stored (or was purged) is `'absent'`. A deleted record keeps a numbered
 * tombstone version, so its token differs from `'absent'`. A writer that observed `'absent'` before
 * the record existed therefore gets `revision-conflict` instead of recreating a deleted record by
 * accident.
 *
 * @param state - The workspace state.
 * @param key - The record to look up.
 * @returns The stored slot's version number, or `'absent'` when there is no slot.
 */
function currentVersion(
  state: WorkspaceState,
  key: ReadVersion['key'],
): ReadVersion['version'] {
  const previous = findSlot(state, key);
  if (!previous) {
    return 'absent';
  }
  return previous.version;
}

/** One check a write must pass, and the message reported when a write breaks it. */
interface WriteRule {
  readonly breaks: (state: WorkspaceState, write: Write) => boolean;
  readonly message: string;
}

/** The write rules, in the order {@link checkWrites} reports them. */
const writeRules: readonly WriteRule[] = [
  { breaks: invalidDelete, message: 'Delete requires a live record' },
  { breaks: invalidPurge, message: 'Purge requires a stored record' },
  { breaks: exhausted, message: 'Record version exhausted' },
];

/** True when at least one write breaks the rule; writes are checked in order. */
function anyWriteBreaks(
  rule: WriteRule,
  state: WorkspaceState,
  writes: readonly Write[],
): boolean {
  return writes.some((write) => rule.breaks(state, write));
}

/** True for a delete whose record is missing or already a tombstone. */
function invalidDelete(
  state: WorkspaceState,
  write: Write,
): boolean {
  if (write.kind !== 'delete') {
    return false;
  }
  const previous = findSlot(state, write.key);
  return previous === undefined || previous.deleted !== false;
}

/** True for a purge whose record has no stored slot, live or tombstoned. */
function invalidPurge(
  state: WorkspaceState,
  write: Write,
): boolean {
  return write.kind === 'purge' && findSlot(state, write.key) === undefined;
}

/** True when the written record is already at the largest safe version number. */
function exhausted(
  state: WorkspaceState,
  write: Write,
): boolean {
  return currentVersion(state, write.key) === Number.MAX_SAFE_INTEGER;
}
