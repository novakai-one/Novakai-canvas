/*
 * The request payload a selection reads, decoded once, and the resources its own source declares.
 * Pure over Language. A payload outside its planner's envelope is `invalid-input`; a source
 * Language refuses is `missing-asset` (refusal.ts). Authoring owns recovery.
 */
import type {
  AuthoringResult,
  Json,
  Language,
  Request,
  ResourceRequest,
} from '../../../contract/records/capability-types.js';
import type { DslCommand, PresetHeader } from '../../../contract/records/planning/commands.js';
import {
  dslCommand,
  modelCommand,
  presetChange,
} from '../../../contract/records/planning/commands.js';
import { andThen, success } from '../../../contract/errors.js';
import { fromOwner, undecodable } from './refusal.js';

/** The owner that reads resource declarations out of DSL and recipe source. */
export interface IntentOwners {
  readonly language: Pick<Language, 'parse'>;
}

/** The request payload, decoded once. Only DSL, model and preset changes are read. */
export type Intent =
  | { readonly planner: 'dsl'; readonly command: DslCommand }
  | { readonly planner: 'model'; readonly collection: string }
  | { readonly planner: 'preset'; readonly admission: PresetHeader }
  | { readonly planner: 'other' };

/** What the request's own source declares. A theme admission binds no assets. */
export type Declared =
  | { readonly kind: 'theme-admission' }
  | {
      readonly kind: 'sources';
      readonly collection: string | null;
      readonly requests: readonly ResourceRequest[];
    };

/**
 * Checks a resource-carrying payload against its planner's envelope; undo, redo and other planners
 * are not read. Fails with `invalid-input` at `resources` for a payload outside the envelope.
 */
export function decodeIntent(request: Request): AuthoringResult<Intent> {
  if (request.intent.kind !== 'change') return success(UNREAD);
  const { planner, payload } = request.intent;
  switch (planner) {
    case 'dsl':
      return dslIntent(payload);
    case 'model':
      return modelIntent(payload);
    case 'preset':
      return presetIntent(payload);
    default:
      return success(UNREAD);
  }
}

/**
 * Only checked DSL or recipe source declares resources, read by Language; no JSON field is taken
 * as a file path. Fails with `missing-asset` at `resources` when Language refuses the source (its
 * failure kept in `source`).
 */
export function declaredResources(
  intent: Intent,
  owners: IntentOwners,
): AuthoringResult<Declared> {
  switch (intent.planner) {
    case 'dsl':
      return dslSources(intent.command, owners);
    case 'model':
      return success({ kind: 'sources', collection: intent.collection, requests: [] });
    case 'preset':
      return presetSources(intent.admission, owners);
    case 'other':
      return success({ kind: 'sources', collection: null, requests: [] });
  }
}

/** The intent of a request whose payload selection does not read. */
const UNREAD: Intent = Object.freeze({ planner: 'other' });

/** A DSL payload. Fails with `invalid-input` at `resources` outside the DSL envelope. */
function dslIntent(payload: Json): AuthoringResult<Intent> {
  const command = dslCommand.safeParse(payload);
  if (!command.success) return undecodable();
  return success({ planner: 'dsl', command: command.data });
}

/** A model payload's collection. Fails with `invalid-input` at `resources` outside its envelope. */
function modelIntent(payload: Json): AuthoringResult<Intent> {
  const command = modelCommand.safeParse(payload);
  if (!command.success) return undecodable();
  return success({ planner: 'model', collection: command.data.collection });
}

/** A preset payload's admission. Fails with `invalid-input` at `resources` outside its envelope. */
function presetIntent(payload: Json): AuthoringResult<Intent> {
  const change = presetChange.safeParse(payload);
  if (!change.success) return undecodable();
  return success({ planner: 'preset', admission: change.data.admission });
}

/**
 * A DSL source's resources, under the collection it names. Fails with `missing-asset` at
 * `resources` when Language refuses the source.
 */
function dslSources(
  command: DslCommand,
  owners: IntentOwners,
): AuthoringResult<Declared> {
  const parsed = fromOwner(owners.language.parse(command.source));
  return andThen(parsed, (read) =>
    success({ kind: 'sources', collection: read.collection, requests: read.resources }),
  );
}

/**
 * A recipe's source declares its assets, under no stored collection; a theme's font bytes are held
 * directly, never bound as assets. Fails with `missing-asset` at `resources` when Language refuses
 * the recipe source.
 */
function presetSources(
  admission: PresetHeader,
  owners: IntentOwners,
): AuthoringResult<Declared> {
  if (admission.kind === 'theme') return success({ kind: 'theme-admission' });
  const parsed = fromOwner(owners.language.parse(admission.source ?? ''));
  return andThen(parsed, (read) =>
    success({ kind: 'sources', collection: null, requests: read.resources }),
  );
}
