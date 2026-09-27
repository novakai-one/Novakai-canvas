import type { Assets } from '@novakai/canvas-assets';
import { failure } from '@novakai/canvas-authoring';
import type {
  Request,
  Snapshot,
  ResourceAdmission,
  ResourceLease,
  Result,
} from '@novakai/canvas-authoring';
import type { ResourceSelector } from '../../contract/records/planning/planning.js';
/** Physical byte protection lasts through authoritative commit/receipt settlement, including prior inverse-history resources. */
function acquire(
  request: Request,
  snapshot: Snapshot,
  selector: ResourceSelector,
  assets: Assets,
): Result<ResourceLease> {
  const selected = selector.select(request, snapshot);
  if (!selected.ok) return selected;
  const lease = assets.acquire(selected.value.covered);
  if (!lease.ok)
    return failure('missing-asset', lease.error.path, lease.error.message, [], lease.error);
  return {
    ok: true,
    value: {
      pins: selected.value.pins,
      reads: selected.value.reads,
      covered: selected.value.covered,
      release: async () => released(lease.value.release()),
    },
  };
}
/** Release failure remains typed; Assets conservatively retains protection for maintenance recovery. */
function released(result: ReturnType<Assets['close']>): Result<void> {
  if (result.ok) return result;
  return failure('storage-unavailable', result.error.path, result.error.message, [], result.error);
}
/** Bind actual Assets leases; even an empty digest set uses the owner's real lifecycle contract. */
export function createResourceAdmission(
  selector: ResourceSelector,
  assets: Assets,
): ResourceAdmission {
  return { acquire: async (request, snapshot) => acquire(request, snapshot, selector, assets) };
}
