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
  Collection,
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
import { authoringFailure, success } from '../../../contract/errors.js';
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
    plan: async (request, snapshot) => planModelChange(request, snapshot, dependencies),
  };
}

/** Reads the batch of Model changes, has Model apply it, then plans the collection's save. */
function planModelChange(
  request: Request,
  snapshot: Snapshot,
  dependencies: ModelPlannerDependencies,
): AuthoringResult<Proposal> {
  const command = readModelCommand(request);
  if (!command.ok) {
    return command;
  }
  const candidate = applyModelChanges(command.value, snapshot, dependencies);
  if (!candidate.ok) {
    return candidate;
  }
  return dependencies.collections.propose(snapshot, candidate.value);
}

/** Takes the Model command (the collection's ID and the batch) out of the request. */
function readModelCommand(request: Request): AuthoringResult<ModelCommand> {
  const payload = readChangePayload(request, 'intent', 'Expected a diagram change');
  if (!payload.ok) {
    return payload;
  }
  const command = modelCommand.safeParse(payload.value);
  if (!command.success) {
    return malformedModelCommandFailure();
  }
  return success(command.data);
}

/** Has Model apply the batch to the stored collection, and gives the changed collection. */
function applyModelChanges(
  command: ModelCommand,
  snapshot: Snapshot,
  dependencies: ModelPlannerDependencies,
): AuthoringResult<Collection> {
  const contents = dependencies.workspace.read(snapshot);
  if (!contents.ok) {
    return contents;
  }
  // A missing collection is passed on as it is; Model answers that mistake itself.
  const stored = contents.value.collections.find(
    (collection) => collection.id === command.collection,
  );
  const planned = dependencies.model.plan(stored, command.changes);
  if (!planned.ok) {
    return capabilityRefusalFailure('invariant-violation', command.collection, planned.error);
  }
  return success(planned.value.candidate);
}

/** Makes the mistake for a Model change without a collection ID or a batch of changes. */
function malformedModelCommandFailure(): AuthoringResult<never> {
  return authoringFailure(
    'invalid-input',
    'model',
    'Human changes require a collection and change batch',
  );
}
