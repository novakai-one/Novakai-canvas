/*
 * Authoring's `dsl` planner role: lowers DSL source text through Language on the stored
 * collection and hands the new collection to the collection planner. Pure over the injected
 * owners. Authoring owns scope, commit and retry.
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
import type { WorkspaceReader } from '../../../contract/records/workspace/contents.js';
import type {
  CollectionPlanner,
  ResourceSelection,
  ResourceSelector,
} from '../../../contract/records/planning/planning.js';
import type { DslCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';
import { changePayload, ownerRejected } from './change-payload.js';

/** What the `dsl` planner uses; compose passes Language from ServiceCapabilities. */
export interface DslPlannerOwners {
  readonly language: Pick<Language, 'parse' | 'lower'>;
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'select'>;
  readonly collections: CollectionPlanner;
}

/**
 * Binds the `dsl` planner, which humans and agents may both address. `plan` fails with `invalid-input` at `intent` (not a change), `dsl` (bad envelope) or `source` (Language
 * parse, source kept), `revision-conflict` at `pins`, or `invariant-violation` at `source`
 * (Language lower, source kept). Reader, selector and collection planner failures pass through
 * unchanged.
 */
export function createDslPlanner(owners: DslPlannerOwners): IntentPlanner {
  return {
    id: plannerId.parse('dsl'),
    plan: async (request, snapshot, pins) => lower(request, snapshot, pins, owners),
  };
}

/**
 * The `dsl` planner: takes the change payload, then lowers it (see `lowerSource`). Fails with
 * `invalid-input` at `intent` when the request is not a change.
 */
function lower(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  owners: DslPlannerOwners,
): AuthoringResult<Proposal> {
  const input = changePayload(request, 'intent', 'Expected a diagram change');
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
  owners: DslPlannerOwners,
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
  owners: DslPlannerOwners,
): AuthoringResult<Proposal> {
  if (JSON.stringify(pins) !== JSON.stringify(selected.pins))
    return authoringFailure(
      'revision-conflict',
      'pins',
      'Resource selection differs from the admitted lease',
    );
  const parsed = owners.language.parse(command.source);
  if (!parsed.ok) return ownerRejected('invalid-input', 'source', parsed.error);
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
  owners: DslPlannerOwners,
): AuthoringResult<Proposal> {
  const view = owners.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === id) ?? null;
  const intent = owners.language.lower({
    ...command,
    snapshot: original,
    resources: selected.resources,
  });
  if (!intent.ok) return ownerRejected('invariant-violation', 'source', intent.error);
  return owners.collections.propose(snapshot, intent.value.collection);
}
