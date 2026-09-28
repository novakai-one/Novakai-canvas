/*
 * Browser storage for drafts, pending requests and preferences, over the browser's `Storage`. The
 * one place that turns a retention place into key text: `novakai.canvas.<slot>`, then
 * `.<workspace>` for a workspace slot. Values are stored as JSON and come back unchecked. Not
 * pure: it reads and writes storage. A storage failure is `draft-retention-unavailable`; the
 * caller reports it and owns recovery.
 */
import type { DraftRetention, RetentionPlace } from '../../contract/ports/draft-retention.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/**
 * The retention port over `storage`. Composition supplies the browser's storage; an in-process
 * `Storage` works the same way.
 */
export function createDraftRetention(storage: Storage): DraftRetention {
  return {
    write: (place, value) => write(storage, place, value),
    read: (place) => read(storage, place),
    remove: (place) => remove(storage, place),
  };
}

/** Every key this app stores starts with this text. */
const KEY_PREFIX = 'novakai.canvas.';

/** The key text of a place. The browser-wide slot has no workspace part. */
function keyText(place: RetentionPlace): string {
  if (place.slot === 'ui-preferences') return `${KEY_PREFIX}${place.slot}`;
  return `${KEY_PREFIX}${place.slot}.${place.workspace}`;
}

/**
 * Stores `value` as JSON at `place`. Fails with `draft-retention-unavailable` when the browser
 * refuses (quota or privacy); the runtime then refuses a submission it could not keep.
 */
function write(
  storage: Storage,
  place: RetentionPlace,
  value: unknown,
): Result<void> {
  try {
    storage.setItem(keyText(place), JSON.stringify(value));
    return { ok: true, value: undefined };
  } catch {
    return failure('draft-retention-unavailable', 'Draft recovery is unavailable in this browser');
  }
}

/**
 * The value at `place`, or `null` when none. It stays unknown until the owning reader checks it.
 * Fails with `draft-retention-unavailable` when storage or the JSON cannot be read.
 */
function read(
  storage: Storage,
  place: RetentionPlace,
): Result<unknown> {
  try {
    const text = storage.getItem(keyText(place));
    if (text === null) return { ok: true, value: null };
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return failure('draft-retention-unavailable', 'Stored draft recovery data could not be read');
  }
}

/**
 * Removes the value at `place` only; other workspaces and slots are untouched. Fails with
 * `draft-retention-unavailable` when storage refuses.
 */
function remove(
  storage: Storage,
  place: RetentionPlace,
): Result<void> {
  try {
    storage.removeItem(keyText(place));
    return { ok: true, value: undefined };
  } catch {
    return failure(
      'draft-retention-unavailable',
      'Stored draft recovery data could not be cleared',
    );
  }
}
