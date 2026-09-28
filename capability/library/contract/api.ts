/*
 * Library's callable boundary: the four entry points, composed from core. Each stores nothing,
 * never throws and returns a frozen result: a throw while reading the input becomes an `invalid-input`
 * failure at `$`. The same input always gives the same result, so a retry is always safe.
 * Authoring owns admission, durable writes and crash recovery.
 *
 * This is the only Library file permitted to import from `core/` (`no-restricted-imports` in
 * eslint.config.js allows it for `contract/api.ts` by name). `index.ts` re-exports these names.
 */
export { validateLibrarySnapshot } from '../core/validation/validate.js';
export { planOrganisation, planMembership } from '../core/organisation/plan.js';
export { queryLibrary } from '../core/discovery/query.js';
