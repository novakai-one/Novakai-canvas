/*
 * Byte restore: exact normalized bytes written back through an Assets reservation, released on
 * every settlement path. Pure over Assets; failures are returned, never thrown. Assets owns byte
 * recovery, and the caller keeps its local backup bytes.
 */
import type { Assets, WriteLease } from '../../../contract/records/capabilities.js';
import type {
  ResourceCommands,
  RestoreInput,
} from '../../../contract/records/presets/preparation.js';
import { restoreInput } from '../../../contract/records/presets/preparation.js';

/** The owner a restore writes through. */
export interface RestoreOwners {
  readonly assets: Pick<Assets, 'reserve'>;
}

/**
 * Restores one digest's bytes under a reservation. Refuses a malformed body with `invalid-input`
 * at `restore`; otherwise answers Assets' reservation, stage or release outcome unchanged.
 */
export async function restore(
  raw: unknown,
  owners: RestoreOwners,
): ReturnType<ResourceCommands['restore']> {
  const checked = restoreInput.safeParse(raw);
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
  return restoreChecked(checked.data, owners);
}

/** Reservation failure leaves no lease; a successful reservation always reaches release. */
async function restoreChecked(
  checked: RestoreInput,
  owners: RestoreOwners,
): ReturnType<ResourceCommands['restore']> {
  const lease = owners.assets.reserve([checked.digest]);
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
