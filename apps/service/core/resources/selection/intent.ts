/*
 * The request payload a selection reads, decoded once, and the resources its own source declares.
 * Pure over Language. A payload outside its planner's envelope throws zod's error (select.ts turns
 * it into `invalid-input`); a source Language refuses throws ResourceFault (`missing-asset`).
 * Authoring owns recovery.
 */
import type { Language, Request, ResourceRequest } from '../../../contract/records/capabilities.js';
import type { DslCommand, PresetAdmission } from '../../../contract/records/planning/commands.js';
import {
  dslCommand,
  modelCommand,
  presetChange,
} from '../../../contract/records/planning/commands.js';
import { accepted } from './refusal.js';

/** The owner that reads resource declarations out of DSL and recipe source. */
export interface IntentOwners {
  readonly language: Pick<Language, 'parse'>;
}

/** The request payload, decoded once. Only DSL, model and preset changes are read. */
export type Intent =
  | { readonly planner: 'dsl'; readonly command: DslCommand }
  | { readonly planner: 'model'; readonly collection: string }
  | { readonly planner: 'preset'; readonly admission: PresetAdmission }
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
 * are not read. Throws zod's error for a payload outside the envelope.
 */
export function decodeIntent(request: Request): Intent {
  if (request.intent.kind !== 'change') return { planner: 'other' };
  const { planner, payload } = request.intent;
  switch (planner) {
    case 'dsl':
      return { planner: 'dsl', command: dslCommand.parse(payload) };
    case 'model':
      return { planner: 'model', collection: modelCommand.parse(payload).collection };
    case 'preset':
      return { planner: 'preset', admission: presetChange.parse(payload).admission };
    default:
      return { planner: 'other' };
  }
}

/**
 * Only checked DSL or recipe source declares resources, read by Language; no JSON field is taken
 * as a file path. Throws ResourceFault with Language's failure in `source` when it refuses.
 */
export function declaredResources(
  intent: Intent,
  owners: IntentOwners,
): Declared {
  switch (intent.planner) {
    case 'dsl': {
      const parsed = accepted(owners.language.parse(intent.command.source));
      return { kind: 'sources', collection: parsed.collection, requests: parsed.resources };
    }
    case 'model':
      return { kind: 'sources', collection: intent.collection, requests: [] };
    case 'preset':
      return presetSources(intent.admission, owners);
    case 'other':
      return { kind: 'sources', collection: null, requests: [] };
  }
}

/** A recipe's source declares its assets; a theme's font bytes are held directly, never bound as assets. */
function presetSources(
  admission: PresetAdmission,
  owners: IntentOwners,
): Declared {
  if (admission.kind === 'theme') return { kind: 'theme-admission' };
  const parsed = accepted(owners.language.parse(admission.source ?? ''));
  return { kind: 'sources', collection: null, requests: parsed.resources };
}
