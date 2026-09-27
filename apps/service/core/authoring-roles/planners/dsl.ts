/*
 * Authoring's two diagram planner roles: `dsl` lowers source text through Language, `model`
 * plans a human change batch through Model. Both hand the new collection to the collection
 * planner. Pure over the injected owners. Authoring owns scope, commit and retry.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Json,
  Language,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capabilities.js';
import type { ModelRules } from '../../../contract/ports/capabilities.js';
import type { WorkspaceReader } from '../../../contract/records/workspace/contents.js';
import type {
  CollectionPlanner,
  ResourceSelection,
  ResourceSelector,
} from '../../../contract/records/planning/planning.js';
import type { DslCommand, ModelCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand, modelCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/** What the diagram planners use; compose passes Model and Language from ServiceCapabilities. */
export interface DiagramPlannerOwners {
  readonly model: Pick<ModelRules, 'plan'>;
  readonly language: Pick<Language, 'parse' | 'lower'>;
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'select'>;
  readonly collections: CollectionPlanner;
}

/**
 * Binds the `dsl` and `model` planners; HTTP credential policy restricts agents to `dsl`. Both
 * fail with `invalid-input` at `intent` for a non-change request. `dsl` also fails with
 * `invalid-input` at `dsl` (bad envelope) or `source` (Language parse, source kept),
 * `revision-conflict` at `pins`, or `invariant-violation` at `source` (Language lower, source
 * kept). `model` also fails with `invalid-input` at `model` or `invariant-violation` at the
 * collection ID (Model plan, source kept). Reader, selector and collection planner failures pass
 * through unchanged.
 */
export function createDiagramPlanners(owners: DiagramPlannerOwners): readonly IntentPlanner[] {
  return [
    {
      id: plannerId.parse('dsl'),
      plan: async (request, snapshot, pins) => lower(request, snapshot, pins, owners),
    },
    {
      id: plannerId.parse('model'),
      plan: async (request, snapshot) => model(request, snapshot, owners),
    },
  ];
}

/**
 * The request's change payload. Fails with `invalid-input` at `intent` for an undo or redo;
 * Authoring runs those itself, so no planner reads them.
 */
function payload(request: Request): AuthoringResult<Json> {
  if (request.intent.kind !== 'change')
    return authoringFailure('invalid-input', 'intent', 'Expected a diagram change');
  return { ok: true, value: request.intent.payload };
}

/**
 * The `dsl` planner: takes the change payload, then lowers it (see `lowerSource`). Fails with
 * `invalid-input` at `intent` when the request is not a change.
 */
function lower(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  owners: DiagramPlannerOwners,
): AuthoringResult<Proposal> {
  const input = payload(request);
  if (!input.ok) return input;
  return lowerSource(input.value, request, snapshot, pins, owners);
}

/**
 * Decodes the DSL command and repeats resource selection on this snapshot, then compiles it (see
 * `compile`). Fails with `invalid-input` at `dsl` when the payload lacks source or mode. Selector
 * failures pass through unchanged.
 */
function lowerSource(
  input: Json,
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  owners: DiagramPlannerOwners,
): AuthoringResult<Proposal> {
  const command = dslCommand.safeParse(input);
  if (!command.success)
    return authoringFailure(
      'invalid-input',
      'dsl',
      'DSL change requires source and an explicit mode',
    );
  const selected = owners.resources.select(request, snapshot);
  if (!selected.ok) return selected;
  return compile(command.data, snapshot, pins, selected.value, owners);
}

/**
 * Parses the source, then lowers it (see `compileCollection`). Fails with `revision-conflict` at
 * `pins` when the selected pins differ from the admitted pins, and `invalid-input` at `source`
 * when Language cannot parse the source (Language's failure kept as source).
 */
function compile(
  command: DslCommand,
  snapshot: Snapshot,
  pins: Json,
  selected: ResourceSelection,
  owners: DiagramPlannerOwners,
): AuthoringResult<Proposal> {
  if (JSON.stringify(pins) !== JSON.stringify(selected.pins))
    return authoringFailure(
      'revision-conflict',
      'pins',
      'Resource selection differs from the admitted lease',
    );
  const parsed = owners.language.parse(command.source);
  if (!parsed.ok)
    return authoringFailure(
      'invalid-input',
      'source',
      'The owning capability rejected this input',
      [],
      parsed.error,
    );
  return compileCollection(command, parsed.value.collection, snapshot, selected, owners);
}

/**
 * Lowers the command against the stored collection (null when not stored yet) and hands the
 * result to the collection planner. Fails with `invariant-violation` at `source` when Language
 * refuses the change (Language's failure kept as source). Reader and collection planner failures
 * pass through unchanged.
 */
function compileCollection(
  command: DslCommand,
  id: string,
  snapshot: Snapshot,
  selected: ResourceSelection,
  owners: DiagramPlannerOwners,
): AuthoringResult<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === id) ?? null;
  const intent = owners.language.lower({
    ...command,
    snapshot: original,
    resources: selected.resources,
  });
  if (!intent.ok)
    return authoringFailure(
      'invariant-violation',
      'source',
      'The owning capability rejected this input',
      [],
      intent.error,
    );
  return owners.collections.propose(snapshot, intent.value.collection);
}

/**
 * The `model` planner: decodes the change batch, then plans it (see `modelCollection`). Fails
 * with `invalid-input` at `intent` when the request is not a change, and at `model` when the
 * payload lacks a collection or change batch.
 */
function model(
  request: Request,
  snapshot: Snapshot,
  owners: DiagramPlannerOwners,
): AuthoringResult<Proposal> {
  const input = payload(request);
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
  owners: DiagramPlannerOwners,
): AuthoringResult<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === command.collection);
  const planned = owners.model.plan(original, command.changes);
  if (!planned.ok)
    return authoringFailure(
      'invariant-violation',
      command.collection,
      'The owning capability rejected this input',
      [],
      planned.error,
    );
  return owners.collections.propose(snapshot, planned.value.candidate);
}
