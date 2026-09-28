/*
 * Why this file exists
 *
 * Agents, and people using the source editor, change diagrams by sending DSL text. For example,
 * `pnpm canvas create flow.canvas` sends a `dsl` change holding the file's text and the mode
 * `create`. Language must read that text and apply it before anything can be saved.
 *
 * This file is the `dsl` planner. Before it runs, Authoring picks the themes and files the change
 * uses and holds them (resource-leases.ts). That pick arrives here as `pins`. The planner picks
 * again and refuses the change (`revision-conflict` at `pins`) if the two picks differ. Then
 * Language applies the text to the stored collection, and collection-proposal.ts plans the save.
 */
import type {
  AuthoringResult,
  Collection,
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
import { authoringFailure, success } from '../../../contract/errors.js';
import { sameResourcesJson } from '../../resources/selection/pins.js';
import { readChangePayload, capabilityRefusalFailure } from './change-payload.js';

/** What the `dsl` planner needs. */
export interface DslPlannerDependencies {
  /** Language. Reads DSL text (`parse`) and applies it to a collection (`lower`). */
  readonly language: Pick<Language, 'parse' | 'lower'>;
  /** Reads the snapshot into checked collections. */
  readonly workspace: Pick<WorkspaceReader, 'read'>;
  /** Picks the themes and files the change uses, to compare with `pins`. */
  readonly resources: Pick<ResourceSelector, 'select'>;
  /** Plans the new collection's save (collection-proposal.ts). */
  readonly collections: CollectionPlanner;
}

/**
 * Builds the `dsl` planner. Its `plan` turns the DSL text into a new collection and answers the
 * planned save. Mistakes: `invalid-input` for a malformed change or text Language can't read,
 * `revision-conflict` at `pins` when the planner's own pick differs from `pins`, or
 * `invariant-violation` at `source` when Language can't apply the text.
 */
export function createDslPlanner(dependencies: DslPlannerDependencies): IntentPlanner {
  return {
    id: plannerId.parse('dsl'),
    plan: async (request, snapshot, pins) => planDslChange(request, snapshot, pins, dependencies),
  };
}

/** Reads the DSL command, checks the pick of themes and files still stands, then applies the text. */
function planDslChange(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  dependencies: DslPlannerDependencies,
): AuthoringResult<Proposal> {
  const command = readDslCommand(request);
  if (!command.ok) {
    return command;
  }
  const selection = pickResourcesAgain(request, snapshot, pins, dependencies);
  if (!selection.ok) {
    return selection;
  }
  return applyDslText(command.value, snapshot, selection.value, dependencies);
}

/** Takes the DSL command (the text and its mode) out of the request. */
function readDslCommand(request: Request): AuthoringResult<DslCommand> {
  const payload = readChangePayload(request, 'intent', 'Expected a diagram change');
  if (!payload.ok) {
    return payload;
  }
  const command = dslCommand.safeParse(payload.value);
  if (!command.success) {
    return malformedDslCommandFailure();
  }
  return success(command.data);
}

/** Picks the change's themes and files again, and checks the pick matches the held one (`pins`). */
function pickResourcesAgain(
  request: Request,
  snapshot: Snapshot,
  pins: Json,
  dependencies: DslPlannerDependencies,
): AuthoringResult<ResourceSelection> {
  const selection = dependencies.resources.select(request, snapshot);
  if (!selection.ok) {
    return selection;
  }
  if (!sameResourcesJson(pins, selection.value.resourcesJson)) {
    return changedPickFailure();
  }
  return success(selection.value);
}

/** Has Language read the text and apply it to the stored collection, then plans the save. */
function applyDslText(
  command: DslCommand,
  snapshot: Snapshot,
  selection: ResourceSelection,
  dependencies: DslPlannerDependencies,
): AuthoringResult<Proposal> {
  const parsed = dependencies.language.parse(command.source);
  if (!parsed.ok) {
    return capabilityRefusalFailure('invalid-input', 'source', parsed.error);
  }
  const collectionId = parsed.value.collection;
  const lowered = lowerOntoStored(command, collectionId, snapshot, selection, dependencies);
  if (!lowered.ok) {
    return lowered;
  }
  return dependencies.collections.propose(snapshot, lowered.value);
}

/** Has Language apply the command to the stored collection (none yet for a new one). */
function lowerOntoStored(
  command: DslCommand,
  collectionId: string,
  snapshot: Snapshot,
  selection: ResourceSelection,
  dependencies: DslPlannerDependencies,
): AuthoringResult<Collection> {
  const stored = findStoredCollection(snapshot, collectionId, dependencies);
  if (!stored.ok) {
    return stored;
  }
  const lowered = dependencies.language.lower({
    ...command,
    snapshot: stored.value,
    resources: selection.resources,
  });
  if (!lowered.ok) {
    return capabilityRefusalFailure('invariant-violation', 'source', lowered.error);
  }
  return success(lowered.value.collection);
}

/** Finds the stored collection with this ID, or `null` when it isn't stored yet. */
function findStoredCollection(
  snapshot: Snapshot,
  collectionId: string,
  dependencies: DslPlannerDependencies,
): AuthoringResult<Collection | null> {
  const contents = dependencies.workspace.read(snapshot);
  if (!contents.ok) {
    return contents;
  }
  const stored = contents.value.collections.find((collection) => collection.id === collectionId);
  return success(stored ?? null);
}

/** Makes the mistake for a DSL change without its text or an explicit mode. */
function malformedDslCommandFailure(): AuthoringResult<never> {
  return authoringFailure(
    'invalid-input',
    'dsl',
    'DSL change requires source and an explicit mode',
  );
}

/** Makes the mistake for a pick of themes and files that differs from the one Authoring holds. */
function changedPickFailure(): AuthoringResult<never> {
  return authoringFailure(
    'revision-conflict',
    'pins',
    'Resource selection differs from the admitted lease',
  );
}
