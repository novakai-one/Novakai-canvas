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
  const request = restoreInput.safeParse(input);
  if (!request.success) {
    return malformedRestoreFailure();
  }
  return holdAndWrite(request.data, dependencies);
}

/** Holds the file, then writes its bytes; if the hold is refused, nothing is written or let go. */
async function holdAndWrite(
  request: RestoreInput,
  dependencies: RestoreDependencies,
): Promise<AssetResult<void>> {
  const lease = dependencies.assets.reserve([request.digest]);
  if (!lease.ok) {
    return lease;
  }
  return writeAndRelease(lease.value, request);
}

/** Writes the bytes, then always lets the hold go; a failed write wins over a failed release. */
async function writeAndRelease(
  lease: WriteLease,
  request: RestoreInput,
): Promise<AssetResult<void>> {
  const written = await lease.stage(request.digest, request.base64);
  const released = lease.release();
  if (!written.ok) {
    return written;
  }
  return released;
}

/** Makes the mistake for a body that is not a digest and base64 text: `invalid-input`. */
function malformedRestoreFailure(): AssetResult<never> {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'restore',
      message: 'Expected digest and normalized base64',
      recovery: 'Retain the original backup.',
    },
  };
}
