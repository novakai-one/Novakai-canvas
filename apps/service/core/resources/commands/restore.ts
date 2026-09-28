/*
 * Why this file exists
 *
 * The CLI keeps a copy of each file it uploaded for a change. If it has to send that change again,
 * the stored file may be gone by then, so it first sends the bytes back:
 * `POST /api/v1/resources/restore` with `{ digest, base64 }`. While they are written, nothing else
 * may write that file.
 *
 * This file checks the body, holds the file, writes the bytes, and then always lets the hold go.
 * It never touches the workspace's records.
 */
import type {
  Assets,
  AssetResult,
  WriteLease,
} from '../../../contract/records/capability-types.js';
import type { RestoreInput } from '../../../contract/records/presets/resource-commands.js';
import type { ResourceCommands } from '../../../contract/ports/workspace.js';
import { restoreInput } from '../../../contract/records/presets/resource-commands.js';

/** What restoring a file needs. */
export interface RestoreDependencies {
  /** The file store, which holds the file while its bytes are written. */
  readonly assets: Pick<Assets, 'reserve'>;
}

/**
 * Puts one file's bytes back from the CLI's copy. `input` is the request body as sent; it is
 * checked here. Fails with `invalid-input` at `restore` for a malformed body. Otherwise it answers
 * the file store's outcome unchanged.
 */
export async function restoreFile(
  input: unknown,
  dependencies: RestoreDependencies,
): Promise<AssetResult<void>> {
  const checked = restoreInput.safeParse(input);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: 'invalid-input',
        path: 'restore',
        message: 'Expected digest and normalized base64',
        recovery: 'Retain the original backup.',
      },
    };
  return restoreChecked(checked.data, dependencies);
}

/** Reservation failure leaves no lease; a successful reservation always reaches release. */
async function restoreChecked(
  checked: RestoreInput,
  dependencies: RestoreDependencies,
): ReturnType<ResourceCommands['restore']> {
  const lease = dependencies.assets.reserve([checked.digest]);
  if (!lease.ok) return lease;
  return restoreReserved(lease.value, checked);
}

/** Stage failure remains primary; release failure is observable only after successful staging. */
async function restoreReserved(
  lease: WriteLease,
  checked: RestoreInput,
): ReturnType<ResourceCommands['restore']> {
  const staged = await lease.stage(checked.digest, checked.base64);
  const released = lease.release();
  if (!staged.ok) return staged;
  return released;
}
