/*
 * Authoring's `model` planner role: plans a human change batch through Model on the stored
 * collection and hands the result to the collection planner. Pure over the injected owners.
 * Authoring owns scope, commit and retry.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { ModelRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceReader } from '../../../contract/records/workspace/contents.js';
import type { CollectionPlanner } from '../../../contract/records/planning/planning.js';
import type { ModelCommand } from '../../../contract/records/planning/commands.js';
import { modelCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';
import { changePayload, ownerRejected } from './change-payload.js';

/** What the `model` planner uses; compose passes Model from ServiceCapabilities. */
export interface ModelPlannerOwners {
  readonly model: Pick<ModelRules, 'plan'>;
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  readonly collections: CollectionPlanner;
}

/**
 * Binds the `model` planner; transport admission never grants it to agents. `plan` fails with
 * `invalid-input` at `intent` (not a change) or `model` (bad envelope), or `invariant-violation`
 * at the collection ID (Model plan, source kept). Reader and collection planner failures pass
 * through unchanged.
 */
export function createModelPlanner(owners: ModelPlannerOwners): IntentPlanner {
  return {
    id: plannerId.parse('model'),
    plan: async (request, snapshot) => model(request, snapshot, owners),
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
  owners: ModelPlannerOwners,
): AuthoringResult<Proposal> {
  const input = changePayload(request, 'intent', 'Expected a diagram change');
  if (!input.ok) return input;
  const command = modelCommand.safeParse(input.value);
  if (!command.success)
    return authoringFailure(
      'invalid-input',
      'model',
      'Human changes require a collection and change batch',
    );
  return modelCollection(command.data, snapshot, owners);
}

/**
 * Plans the batch on the stored collection through Model and hands the result to the collection
 * planner. Fails with `invariant-violation` at the collection ID when Model refuses the batch
 * (Model's failure kept as source). Reader and collection planner failures pass through unchanged.
 */
function modelCollection(
  command: ModelCommand,
  snapshot: Snapshot,
  owners: ModelPlannerOwners,
): AuthoringResult<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === command.collection);
  const planned = owners.model.plan(original, command.changes);
  if (!planned.ok) return ownerRejected('invariant-violation', command.collection, planned.error);
  return owners.collections.propose(snapshot, planned.value.candidate);
}
