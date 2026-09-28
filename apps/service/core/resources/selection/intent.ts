/*
 * Why this file exists
 *
 * Only DSL, Model and preset changes can use themes and files. For example, a DSL change's text
 * may say `asset @logo image source="./logo.png"`, and only Language can read that line. So the
 * selector first reads which kind of change it has, then asks Language what its text declares. A
 * file is only ever found through Language, never by reading a path out of the JSON.
 *
 * This file does both reads. A payload that fails its planner's check is `invalid-input`; text
 * Language refuses is `missing-asset`. Both are at `resources`, and nothing is saved.
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
  presetCommandHeader,
} from '../../../contract/records/planning/commands.js';
import { success } from '../../../contract/errors.js';
import { fromCapability, unreadableRequestFailure } from './refusal.js';

/** What reading the declared themes and files needs. */
export interface IntentDependencies {
  /** Language's parser, which reads the themes and files a DSL or recipe text declares. */
  readonly language: Pick<Language, 'parse'>;
}

/**
 * A change's payload, read once, for the planners whose changes can use themes and files. A Model
 * change keeps only its collection ID, as text. Any other change is `other`, its payload unread.
 */
export type Intent =
  | { readonly planner: 'dsl'; readonly command: DslCommand }
  | { readonly planner: 'model'; readonly collection: string }
  | { readonly planner: 'preset'; readonly admission: PresetHeader }
  | { readonly planner: 'other' };

/**
 * What a change's own text declares. A theme being saved declares nothing (`theme-admission`).
 * Otherwise `collection` is the ID, as text, of the saved collection whose earlier files may be
 * reused (`null` for none), and `requests` are the theme and asset lines Language read.
 */
export type DeclaredResources =
  | { readonly kind: 'theme-admission' }
  | {
      readonly kind: 'sources';
      readonly collection: string | null;
      readonly requests: readonly ResourceRequest[];
    };

/**
 * Reads a change's payload, if its planner can use themes and files (see `Intent`). Undo, redo and
 * every other change come back as `other`. Fails with `invalid-input` at `resources` when the
 * payload fails its planner's check.
 */
export function decodeIntent(request: Request): AuthoringResult<Intent> {
  if (request.intent.kind !== 'change') {
    return success(UNREAD);
  }
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
 * Asks Language which themes and files a DSL or recipe text declares. A Model change declares
 * none, but names its collection. Fails with `missing-asset` at `resources` when Language refuses
 * the text (its failure kept as `source`).
 */
export function readDeclaredResources(
  intent: Intent,
  dependencies: IntentDependencies,
): AuthoringResult<DeclaredResources> {
  switch (intent.planner) {
    case 'dsl':
      return dslSources(intent.command, dependencies);
    case 'model':
      return success(nothingDeclared(intent.collection));
    case 'preset':
      return presetSources(intent.admission, dependencies);
    case 'other':
      return success(nothingDeclared(null));
  }
}

/** The intent of a request whose payload selection does not read. */
const UNREAD: Intent = Object.freeze({ planner: 'other' });

/** What a theme being saved declares: nothing, because its fonts are held directly. */
const THEME_ADMISSION: DeclaredResources = Object.freeze({ kind: 'theme-admission' });

/** Checks a DSL payload against the DSL planner's envelope. */
function dslIntent(payload: Json): AuthoringResult<Intent> {
  const command = dslCommand.safeParse(payload);
  if (!command.success) {
    return unreadableRequestFailure();
  }
  return success({ planner: 'dsl', command: command.data });
}

/** Checks a Model payload against its envelope, and keeps only its collection ID. */
function modelIntent(payload: Json): AuthoringResult<Intent> {
  const command = modelCommand.safeParse(payload);
  if (!command.success) {
    return unreadableRequestFailure();
  }
  return success({ planner: 'model', collection: command.data.collection });
}

/** Checks a preset payload against its envelope, and keeps only its admission. */
function presetIntent(payload: Json): AuthoringResult<Intent> {
  const change = presetCommandHeader.safeParse(payload);
  if (!change.success) {
    return unreadableRequestFailure();
  }
  return success({ planner: 'preset', admission: change.data.admission });
}

/** Asks Language which themes and files a DSL text declares, and which collection it names. */
function dslSources(
  command: DslCommand,
  dependencies: IntentDependencies,
): AuthoringResult<DeclaredResources> {
  const parsed = fromCapability(dependencies.language.parse(command.source));
  if (!parsed.ok) {
    return parsed;
  }
  const declared = declaredSources(parsed.value.collection, parsed.value.resources);
  return success(declared);
}

/** Declares nothing for a theme being saved; reads a recipe's text for its theme and file lines. */
function presetSources(
  admission: PresetHeader,
  dependencies: IntentDependencies,
): AuthoringResult<DeclaredResources> {
  if (admission.kind === 'theme') {
    return success(THEME_ADMISSION);
  }
  return recipeSources(admission.source ?? '', dependencies);
}

/** Asks Language which themes and files a recipe's text declares (it has no saved collection). */
function recipeSources(
  recipeSource: string,
  dependencies: IntentDependencies,
): AuthoringResult<DeclaredResources> {
  const parsed = fromCapability(dependencies.language.parse(recipeSource));
  if (!parsed.ok) {
    return parsed;
  }
  const declared = declaredSources(null, parsed.value.resources);
  return success(declared);
}

/** Makes the declaration of a change with no theme or file lines: only its collection, if any. */
function nothingDeclared(collection: string | null): DeclaredResources {
  return declaredSources(collection, []);
}

/** Makes the declaration of a change's lines, and of the collection it may reuse files from. */
function declaredSources(
  collection: string | null,
  requests: readonly ResourceRequest[],
): DeclaredResources {
  return { kind: 'sources', collection, requests };
}
