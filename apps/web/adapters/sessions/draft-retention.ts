import type { DraftRetention } from '../../contract/ports/draft-retention.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** Browser quota/privacy failure is visible. The runtime refuses a submission whose pending request could not be retained. */
function write(
  storage: Storage,
  key: string,
  value: unknown,
): Result<void> {
  try {
    storage.setItem(`novakai.canvas.${key}`, JSON.stringify(value));
    return { ok: true, value: undefined };
  } catch {
    return failure('draft-retention-unavailable', 'Draft recovery is unavailable in this browser');
  }
}
/** Recovered content remains unknown until the owning editor/Authoring schema admits it. */
function read(
  storage: Storage,
  key: string,
): Result<unknown> {
  try {
    const text = storage.getItem(`novakai.canvas.${key}`);
    if (text === null) return { ok: true, value: null };
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return failure('draft-retention-unavailable', 'Stored draft recovery data could not be read');
  }
}
/** Clear only a confirmed/discarded host key; other collections and preferences are unaffected. */
function remove(
  storage: Storage,
  key: string,
): Result<void> {
  try {
    storage.removeItem(`novakai.canvas.${key}`);
    return { ok: true, value: undefined };
  } catch {
    return failure(
      'draft-retention-unavailable',
      'Stored draft recovery data could not be cleared',
    );
  }
}
/** Storage is supplied by browser composition and can be replaced by an in-process contract fixture. */
export function createDraftRetention(storage: Storage): DraftRetention {
  return {
    write: (key, value) => write(storage, key, value),
    read: (key) => read(storage, key),
    remove: (key) => remove(storage, key),
  };
}
