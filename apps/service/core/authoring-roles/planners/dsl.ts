/*
 * Why this file exists
 *
 * Agents, and people using the source editor, change diagrams by sending DSL text. For example,
 * `pnpm canvas create flow.canvas` sends a `dsl` change holding the file's text and the mode
 * `create`. Language must read that text and apply it before anything can be saved.
 *
 * This file is the `dsl` planner. It checks the themes and files picked for the request haven't
 * changed, and asks Language to read the text and apply it to the stored collection. The new
 * collection goes on to the collection planner (collection-proposal.ts). Authoring saves it.
 */
import type {
  AuthoringResult,
  IntentPlanner,
  Json,
  Language,
  Proposal,
  Request,
  Snapshot,
} from '../../../contract/records/capability-types.js';
import type {
  CollectionPlanner,
  ResourceSelector,
  WorkspaceReader,
} from '../../../contract/ports/workspace.js';
import type { ResourceSelection } from '../../../contract/records/planning/selection.js';
import type { DslCommand } from '../../../contract/records/planning/commands.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { plannerId } from '../../../contract/schemas.js';
import { authoringFailure } from '../../../contract/errors.js';
import { sameResourcesJson } from '../../resources/selection/pins.js';
import { readChangePayload, capabilityRefusalFailure } from './change-payload.js';

/** What the `dsl` planner needs. */
export interface DslPlannerDependencies {
  /** Language. Reads DSL text (`parse`) and applies it to a collection (`lower`). */
  readonly language: Pick<Language, 'parse' | 'lower'>;
  /** Reads the snapshot into checked collections. */
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  /** Picks the themes and files the request uses, again, on this snapshot. */
  readonly resources: Pick<ResourceSelector, 'select'>;
  /** Plans the new collection's save (collection-proposal.ts). */
  readonly collections: CollectionPlanner;
}

/**
 * Builds the `dsl` planner. Its `plan` turns the DSL text into a new collection and answers the
 * planned save. Mistakes: `invalid-input` for a malformed change or text Language can't read,
 * `revision-conflict` at `pins` when the picked themes or files changed, or `invariant-violation`
 * at `source` when Language can't apply the text.
 */
export function createDslPlanner(dependencies: DslPlannerDependencies): IntentPlanner {
  return {
    id: plannerId.parse('dsl'),
    plan: async (request, snapshot, pins) => lower(request, snapshot, pins, dependencies),
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
  dependencies: DslPlannerDependencies,
): AuthoringResult<Proposal> {
  const input = readChangePayload(request, 'intent', 'Expected a diagram change');
  if (!input.ok) return input;
  return lowerSource(input.value, request, snapshot, pins, dependencies);
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
  dependencies: DslPlannerDependencies,
): AuthoringResult<Proposal> {
  const command = dslCommand.safeParse(input);
  if (!command.success)
    return authoringFailure(
      'invalid-input',
      'dsl',
      'DSL change requires source and an explicit mode',
    );
  const selected = dependencies.resources.select(request, snapshot);
  if (!selected.ok) return selected;
  return compile(command.data, snapshot, pins, selected.value, dependencies);
}

/**
 * Parses the source, then lowers it (see `compileCollection`). Fails with `revision-conflict` at
 * `pins` when the selected pins differ from the admitted pins in any value (see
 * `sameResourcesJson`), and `invalid-input` at `source` when Language cannot parse the source
 * (Language's failure kept as source).
 */
function compile(
  command: DslCommand,
  snapshot: Snapshot,
  pins: Json,
  selected: ResourceSelection,
  dependencies: DslPlannerDependencies,
): AuthoringResult<Proposal> {
  if (!sameResourcesJson(pins, selected.resourcesJson))
    return authoringFailure(
      'revision-conflict',
      'pins',
      'Resource selection differs from the admitted lease',
    );
  const parsed = dependencies.language.parse(command.source);
  if (!parsed.ok) return capabilityRefusalFailure('invalid-input', 'source', parsed.error);
  return compileCollection(command, parsed.value.collection, snapshot, selected, dependencies);
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
  dependencies: DslPlannerDependencies,
): AuthoringResult<Proposal> {
  const view = dependencies.workspace.read(snapshot);
  if (!view.ok) return view;
  const original = view.value.collections.find((item) => item.id === id) ?? null;
  const intent = dependencies.language.lower({
    ...command,
    snapshot: original,
    resources: selected.resources,
  });
  if (!intent.ok) return capabilityRefusalFailure('invariant-violation', 'source', intent.error);
  return dependencies.collections.propose(snapshot, intent.value.collection);
}
