/*
 * The one failure record of nested support admission and embedding. Types only; nothing here
 * runs. A leaf file, so the road scene can carry the failure without importing the support
 * ledger records (which refer back to the scene).
 */
/** Deterministic admission failures retain the producing identities and numeric witness. */
export interface NestedSupportFailure {
  readonly code: 'infeasible-embedding';
  readonly reason:
    | 'missing-contact'
    | 'mismatched-contact'
    | 'empty-interval'
    | 'insufficient-terminal-pins'
    | 'unsupported-support'
    | 'cyclic-constraints'
    | 'unroutable-reservation';
  readonly provenance: readonly string[];
  readonly required: readonly number[];
  readonly available: readonly number[];
}
