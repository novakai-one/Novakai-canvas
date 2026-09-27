/*
 * Authoring's resource admission role: selects a request's resources and holds their bytes under
 * an Assets lease until Authoring settles the commit or receipt. Pure over the injected selector
 * and Assets; Assets keeps protection for maintenance recovery when a release fails.
 */
import type {
  Assets,
  AuthoringResult,
  Request,
  ResourceAdmission,
  ResourceLease,
  Snapshot,
} from '../../contract/records/capabilities.js';
import type { ResourceSelector } from '../../contract/records/planning/planning.js';
import { authoringFailure } from '../../contract/errors.js';

/**
 * Binds actual Assets leases; even an empty digest set uses the owner's real lifecycle contract.
 * `acquire` answers the selector's failure unchanged, or `missing-asset` (Assets' failure kept as
 * source) when the bytes cannot be leased. `release` answers `storage-unavailable` (source kept).
 */
export function createResourceAdmission(
  selector: Pick<ResourceSelector, 'select'>,
  assets: Pick<Assets, 'acquire'>,
): ResourceAdmission {
  return { acquire: async (request, snapshot) => acquire(request, snapshot, selector, assets) };
}
/** Physical byte protection lasts through authoritative commit/receipt settlement, including prior inverse-history resources. */
function acquire(
  request: Request,
  snapshot: Snapshot,
  selector: Pick<ResourceSelector, 'select'>,
  assets: Pick<Assets, 'acquire'>,
): AuthoringResult<ResourceLease> {
  const selected = selector.select(request, snapshot);
  if (!selected.ok) return selected;
  const lease = assets.acquire(selected.value.covered);
  if (!lease.ok)
    return authoringFailure(
      'missing-asset',
      lease.error.path,
      lease.error.message,
      [],
      lease.error,
    );
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
function released(result: ReturnType<Assets['close']>): AuthoringResult<void> {
  if (result.ok) return result;
  return authoringFailure(
    'storage-unavailable',
    result.error.path,
    result.error.message,
    [],
    result.error,
  );
}
