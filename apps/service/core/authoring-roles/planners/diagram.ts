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
import type { DslCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand, modelCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';

/** What the diagram planners use; compose passes Model and Language from ServiceCapabilities. */
export interface DiagramPlannerOwners {
  readonly model: Pick<ModelRules, 'plan'>;
  readonly language: Pick<Language, 'parse' | 'lower'>;
  readonly workspace: WorkspaceReader;
  readonly resources: ResourceSelector;
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
/** A planner never interprets an undo/redo payload; Authoring owns those journal-based operations. */
function payload(request: Request): AuthoringResult<Json> {
  if (request.intent.kind !== 'change')
    return authoringFailure('invalid-input', 'intent', 'Expected a diagram change');
  return { ok: true, value: request.intent.payload };
}
/** Current snapshot and admitted pins form one immutable lowering context, preventing alias drift during application. */
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
/** Invalid syntax/semantics returns diagnostics before any catalog or collection write is proposed. */
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
/** Recomputed aliases must match the lease decision exactly; a new alias interpretation requires a fresh preparation. */
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
/** Language's public lower operation validates Model changes; create receives the actual absence/presence state. */
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
/** Human-generated Model changes pass through the same Authoring gate and final cross-owner validation. */
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
/** Missing or invalid changed records never become raw JSON writes. */
function modelCollection(
  command: { readonly collection: string; readonly changes: readonly unknown[] },
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
