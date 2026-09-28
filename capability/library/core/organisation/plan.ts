/*
 * Planning an ordered batch of organisation changes as one atomic transition. Nothing is written: the
 * host commits the candidate only if the read versions are unchanged. Authoring owns admission,
 * the conditional commit and crash recovery.
 */
import type { Organisation } from '../../contract/records/organisation.js';
import { changesSchema, type OrganisationChange } from '../../contract/records/change.js';
import {
  inventorySchema,
  type LibrarySnapshot,
  type CollectionProjection,
} from '../../contract/records/snapshot.js';
import type { MembershipInput, OrganisationPlan, PlanInput } from '../../contract/types.js';
import type { LibraryResult } from '../../contract/errors.js';
import { validateLibrarySnapshot } from '../validation/validate.js';
import { parse, protect, success } from '../shared/outcomes.js';
import { hasCollection } from '../shared/lookups.js';
import { readVersions } from '../shared/versions.js';
import { applyOperation } from './operations.js';

/**
 * Plans an ordered batch of organisation changes as one atomic transition, checked against the
 * snapshot's own collections.
 *
 * Steps; the first failure stops the plan and no partial candidate is returned:
 * 1. Validate the original snapshot.
 * 2. Parse the changes.
 * 3. Apply the changes in order to the original organisation.
 * 4. Validate the candidate against the inventory.
 *
 * Nothing is written. The candidate keeps the original revision, `versions` are the original read
 * revisions, and `changed` is the net effect. A throw while reading the input becomes an
 * `invalid-input` failure at `$`.
 */
export function planOrganisation(input: PlanInput): LibraryResult<OrganisationPlan> {
  return protect(() => {
    const prepared = preparePlan(input);
    if (!prepared.ok) {
      return prepared;
    }
    return applyBatch(prepared.value, prepared.value.before.collections);
  });
}

/**
 * Plans a batch that registers or removes collections: the candidate is checked against the
 * collection inventory Authoring is about to commit (`inventory`) instead of the snapshot's own.
 * Everything else matches `planOrganisation`.
 */
export function planMembership(input: MembershipInput): LibraryResult<OrganisationPlan> {
  return protect(() => {
    const prepared = preparePlan(input);
    if (!prepared.ok) {
      return prepared;
    }
    return applyBatch(prepared.value, input.inventory);
  });
}

/** A validated snapshot and its parsed change batch, ready to apply. */
interface PreparedBatch {
  readonly before: LibrarySnapshot;
  readonly changes: readonly OrganisationChange[];
}

/** Validates the original snapshot, then parses the change batch. */
function preparePlan(input: PlanInput): LibraryResult<PreparedBatch> {
  const before = validateLibrarySnapshot(input.snapshot);
  if (!before.ok) {
    return before;
  }
  const changes = parse(changesSchema(), input.changes);
  if (!changes.ok) {
    return changes;
  }
  return success({ before: before.value, changes: changes.value });
}

/** Parses the inventory, applies every change, then validates the candidate. */
function applyBatch(
  prepared: PreparedBatch,
  inventory: unknown,
): LibraryResult<OrganisationPlan> {
  const collections = parse(inventorySchema(), inventory);
  if (!collections.ok) {
    return collections;
  }
  // `applyNext` passes the first failure along unchanged, so later changes are skipped.
  const applied = prepared.changes.reduce(applyNext, success(prepared.before.organisation));
  if (!applied.ok) {
    return applied;
  }
  return validateCandidate(prepared.before, applied.value, collections.value);
}

/** Applies the next change, or passes an earlier failure on unchanged. */
function applyNext(
  current: LibraryResult<Organisation>,
  change: OrganisationChange,
): LibraryResult<Organisation> {
  if (!current.ok) {
    return current;
  }
  return applyOperation(current.value, change);
}

/**
 * Validates the candidate organisation with the final inventory (recent visits to removed collections
 * dropped), then builds the plan. `changed` compares the JSON text of both organisations.
 */
function validateCandidate(
  before: LibrarySnapshot,
  organisation: Organisation,
  collections: readonly CollectionProjection[],
): LibraryResult<OrganisationPlan> {
  const recent = before.recent.filter((visit) => hasCollection(collections, visit.collection));
  const validated = validateLibrarySnapshot({ organisation, collections, recent });
  if (!validated.ok) {
    return validated;
  }
  const candidate = validated.value.organisation;
  const changed = JSON.stringify(candidate) !== JSON.stringify(before.organisation);
  return success({ candidate, changed, versions: readVersions(before) });
}
