import { plan as planModel } from '@novakai/canvas-model';
import { failure, plannerId } from '@novakai/canvas-authoring';
import type {
  IntentPlanner,
  Request,
  Snapshot,
  Json,
  Proposal,
  Result,
} from '@novakai/canvas-authoring';
import { dslCommand, modelCommand } from '../../contract/records/planning/commands.js';
import type { DiagramPlannerOwners } from '../../contract/records/planning/planning.js';
/** A planner never interprets an undo/redo payload; Authoring owns those journal-based operations. */
function payload(request: Request): Result<Json> {
  if (request.intent.kind !== 'change')
    return failure('invalid-input', 'intent', 'Expected a diagram change');
  return { ok: true, value: request.intent.payload };
}
/** Current snapshot and admitted pins form one immutable lowering context, preventing alias drift during application. */
function lower(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  owners: DiagramPlannerOwners,
): Result<Proposal> {
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
): Result<Proposal> {
  const command = dslCommand.safeParse(input);
  if (!command.success)
    return failure('invalid-input', 'dsl', 'DSL change requires source and an explicit mode');
  const selected = owners.resources.select(request, snapshot);
  if (!selected.ok) return selected;
  return compile(command.data, snapshot, pins, selected.value, owners);
}
/** Recomputed aliases must match the lease decision exactly; a new alias interpretation requires a fresh preparation. */
function compile(
  command: { readonly source: string; readonly mode: 'create' | 'replace' | 'patch' },
  snapshot: Snapshot,
  pins: Json,
  selected: import('../../contract/records/planning/planning.js').ResourceSelection,
  owners: DiagramPlannerOwners,
): Result<Proposal> {
  if (JSON.stringify(pins) !== JSON.stringify(selected.pins))
    return failure(
      'revision-conflict',
      'pins',
      'Resource selection differs from the admitted lease',
    );
  const parsed = owners.language.parse(command.source);
  if (!parsed.ok)
    return failure(
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
  command: { readonly source: string; readonly mode: 'create' | 'replace' | 'patch' },
  id: string,
  snapshot: Snapshot,
  selected: import('../../contract/records/planning/planning.js').ResourceSelection,
  owners: DiagramPlannerOwners,
): Result<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === id) ?? null;
  const intent = owners.language.lower({
    ...command,
    snapshot: original,
    resources: selected.resources,
  });
  if (!intent.ok)
    return failure(
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
): Result<Proposal> {
  const input = payload(request);
  if (!input.ok) return input;
  const command = modelCommand.safeParse(input.value);
  if (!command.success)
    return failure('invalid-input', 'model', 'Human changes require a collection and change batch');
  return modelCollection(command.data, snapshot, owners);
}
/** Missing or invalid changed records never become raw JSON writes. */
function modelCollection(
  command: { readonly collection: string; readonly changes: readonly unknown[] },
  snapshot: Snapshot,
  owners: DiagramPlannerOwners,
): Result<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === command.collection);
  const planned = planModel(original, command.changes);
  if (!planned.ok)
    return failure(
      'invariant-violation',
      command.collection,
      'The owning capability rejected this input',
      [],
      planned.error,
    );
  return owners.collections.propose(snapshot, planned.value.candidate);
}
/** Trusted composition registers two explicit pathways; HTTP credential policy restricts agents to readable DSL. */
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
