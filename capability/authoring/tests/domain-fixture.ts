import {
  validate as validateModel,
  plan as planModel,
  type Collection,
} from '@novakai/canvas-model';
import { validateLibrarySnapshot } from '@novakai/canvas-library';
import {
  proposalSchema,
  plannerId,
  failure,
  type CandidateValidator,
  type IntentPlanner,
  type Intent,
  type Result,
  type Snapshot,
  type StoredRecord,
  type ReadVersion,
  type Proposal,
} from '../contract/index.js';

/**
 * The test planner, registered as `fixture`. It proposes exactly the writes in the request's
 * payload, so tests can aim at one Authoring check at a time. Every successful candidate still
 * passes the real Model and Library validation in `domainValidator`.
 *
 * `plan(request)` returns the payload as a checked proposal, or `invalid-input` at `intent` for an
 * undo or redo, or at `payload` when the payload is not a proposal. It does not throw.
 */
export const fixturePlanner: IntentPlanner = {
  id: plannerId.parse('fixture'),
  plan: async (request) => readProposal(request.intent),
};

/**
 * Validates a candidate with the real domain owners, the way a host does after planning and
 * revision stamping.
 *
 * `validate(before, after)` checks the `after` snapshot and returns the versions the candidate
 * depends on, read from `before`. Failures are `invariant-violation` results; the Model or Library
 * failure behind them is not kept. It does not throw for well-formed snapshots.
 *
 * - Every live collection must pass Model validation and an empty Model plan.
 * - The live catalog must pass Library validation with every live collection. A workspace with
 *   no catalog and no collections passes.
 * - When it passes, the candidate depends on the catalog's version, if a catalog is stored.
 */
export const domainValidator: CandidateValidator = {
  validate: async (before, after) => {
    const collections = validateCollections(after);
    if (!collections.ok) return collections;
    const inventory = validateInventory(after, collections.value);
    if (!inventory.ok) return inventory;
    return { ok: true, value: dependencies(before) };
  },
};

/** Reads the test planner's payload as a proposal. Only `change` intents are accepted. */
function readProposal(intent: Intent): Result<Proposal> {
  if (intent.kind !== 'change')
    return failure('invalid-input', 'intent', 'Fixture requires change');
  const parsed = proposalSchema.safeParse(intent.payload);
  if (!parsed.success) return failure('invalid-input', 'payload', 'Fixture payload malformed');
  return { ok: true, value: parsed.data };
}

/** Checks one collection with Model: it must be valid and accept an empty plan. */
function checkedCollection(record: StoredRecord): Result<Collection> {
  const result = validateModel(record.value);
  if (!result.ok) return failure('invariant-violation', 'collection', 'Model rejected candidate');
  const planned = planModel(result.value, []);
  if (!planned.ok)
    return failure('invariant-violation', 'collection', 'Model rejected empty transition');
  return { ok: true, value: planned.value.candidate };
}

/** Builds the search summary Library receives for a collection, not a second copy of its content. */
function projection(collection: Collection): unknown {
  return {
    id: collection.id,
    revision: collection.revision,
    title: collection.title,
    description: collection.description ?? '',
    sections: collection.sections.map((section) => ({ id: section.id, title: section.title })),
    objects: collection.objects.map((object) => ({
      id: object.id,
      label: object.label,
      description: '',
      visibleIn: [],
    })),
  };
}

/**
 * Checks the catalog with Library. A workspace with no live catalog and no live collections passes;
 * otherwise there must be exactly one live catalog, and Library must accept it.
 */
function validateInventory(
  snapshot: Snapshot,
  collections: readonly Collection[],
): Result<void> {
  const catalogs = snapshot.records.filter(
    (record) => record.key.kind === 'catalog' && !record.deleted,
  );
  if (catalogs.length === 0 && collections.length === 0) return { ok: true, value: undefined };
  const result = validateLibrarySnapshot({
    organisation: catalogs[0]?.value,
    collections: collections.map(projection),
    recent: [],
  });
  return checkedInventory(catalogs.length, result.ok);
}

/** Fails unless there is exactly one live catalog and Library accepted it. */
function checkedInventory(
  count: number,
  valid: boolean,
): Result<void> {
  if (count !== 1 || !valid)
    return failure('invariant-violation', 'catalog', 'Library rejected catalog membership');
  return { ok: true, value: undefined };
}

/**
 * Checks every live collection with Model. Returns the first failure, or every checked collection
 * when all pass.
 */
function validateCollections(snapshot: Snapshot): Result<readonly Collection[]> {
  const results = snapshot.records
    .filter((record) => record.key.kind === 'collection' && !record.deleted)
    .map(checkedCollection);
  const rejected = results.find((result) => !result.ok);
  if (rejected !== undefined && !rejected.ok) return rejected;
  return { ok: true, value: acceptedValues(results) };
}

/** Lists the values of the successful results, in order. */
function acceptedValues<T>(results: readonly Result<T>[]): T[] {
  return results.flatMap((result) => (result.ok ? [result.value] : []));
}

/**
 * Lists the versions the candidate depends on: the stored catalog's, when there is one. This stops
 * a concurrent catalog change; an edit to one collection does not depend on the others.
 */
function dependencies(before: Snapshot): readonly ReadVersion[] {
  const catalog = before.records.find((record) => record.key.kind === 'catalog');
  if (!catalog) return [];
  return [{ key: catalog.key, version: catalog.version }];
}
