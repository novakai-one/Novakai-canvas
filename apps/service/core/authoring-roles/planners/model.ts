/*
 * Why this file exists
 *
 * In the browser, a person changes a diagram by hand, not by writing DSL. The browser sends those
 * edits as a batch of Model changes. For example, hiding an object in one section sends a `model`
 * change holding the collection's ID and `{ op: 'hide', section, object }`.
 *
 * This file is the `model` planner. It asks Model to apply the batch to the stored collection, then
 * hands the new collection to the collection planner (collection-proposal.ts). Agents can't use
 * it. It only plans; Authoring saves.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import type { ModelRules } from '../../../contract/ports/capabilities.js';
import type { CollectionPlanner, WorkspaceReader } from '../../../contract/ports/workspace.js';
import type { ModelCommand } from '../../../contract/records/planning/commands.js';
import { modelCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';
import { readChangePayload, capabilityRefusalFailure } from './change-payload.js';

/** What the `model` planner needs. */
export interface ModelPlannerDependencies {
  /** Model's rules. Applies a batch of changes to a collection. */
  readonly model: Pick<ModelRules, 'plan'>;
  /** Reads the snapshot into checked collections. */
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  /** Plans the new collection's save (collection-proposal.ts). */
  readonly collections: CollectionPlanner;
}

/**
 * Builds the `model` planner. Its `plan` applies a batch of Model changes to the stored collection
 * and answers the planned save. Mistakes: `invalid-input` when the request isn't a change or lacks
 * a collection or batch, or `invariant-violation` at the collection's ID when Model refuses the
 * batch. The reader's and collection planner's pass through.
 */
export function createModelPlanner(dependencies: ModelPlannerDependencies): IntentPlanner {
  return {
    id: plannerId.parse('model'),
    plan: async (request, snapshot) => model(request, snapshot, dependencies),
  };
}

/**
 * The `model` planner: decodes the change batch, then plans it (see `modelCollection`). Fails
 * with `invalid-input` at `intent` when the request is not a change, and at `model` when the
 * payload lacks a collection or change batch.
 */
function model(
  request: Request,
  snapshot: Snapshot,
  dependencies: ModelPlannerDependencies,
): AuthoringResult<Proposal> {
  const input = readChangePayload(request, 'intent', 'Expected a diagram change');
  if (!input.ok) return input;
  const command = modelCommand.safeParse(input.value);
  if (!command.success)
    return authoringFailure(
      'invalid-input',
      'model',
      'Human changes require a collection and change batch',
    );
  return modelCollection(command.data, snapshot, dependencies);
}

/**
 * Plans the batch on the stored collection through Model and hands the result to the collection
 * planner. Fails with `invariant-violation` at the collection ID when Model refuses the batch
 * (Model's failure kept as source). Reader and collection planner failures pass through unchanged.
 */
function modelCollection(
  command: ModelCommand,
  snapshot: Snapshot,
  dependencies: ModelPlannerDependencies,
): AuthoringResult<Proposal> {
  const view = dependencies.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === command.collection);
  const planned = dependencies.model.plan(original, command.changes);
  if (!planned.ok)
    return capabilityRefusalFailure('invariant-violation', command.collection, planned.error);
  return dependencies.collections.propose(snapshot, planned.value.candidate);
}
