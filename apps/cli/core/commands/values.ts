/*
 * Why this file exists
 *
 * Everything an agent types is text. In `pnpm canvas replace plan.canvas --revision 3`, the `3` is
 * text, not a number, and has to be checked before the CLI can use it.
 *
 * This file has one check per kind of value, such as a revision, a collection ID or a file path.
 * Each turns the text into a checked type, or says what was wrong. It never opens a file or talks
 * to the service.
 */
import {
  collectionId,
  collectionRevision,
  filePath,
  objectId,
  profileId,
  requestId,
  sectionId,
} from '../../contract/brands.js';
import type {
  CollectionId,
  CollectionRevision,
  FilePath,
  ProfileId,
  RequestId,
} from '../../contract/brands.js';
import type {
  ChangeMode,
  CommandName,
  OutOption,
  ReadScope,
  RequestOption,
  RevisionOption,
} from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import {
  failure,
  success,
  unreadableSourceFailure,
  unwritableOutputFailure,
} from '../../contract/errors.js';
import type { FlagTextAsTyped } from './flags.js';

/** The change mode when --mode is absent. */
const defaultMode: ChangeMode = 'create';

/** Every change mode, keyed by itself. */
const changeModes: Readonly<Record<ChangeMode, ChangeMode>> = Object.freeze({
  create: 'create',
  replace: 'replace',
  patch: 'patch',
});

/** Digits only: the text a revision may be written as. */
const digitsOnly = /^[0-9]+$/;

/**
 * Works out which part of a collection `read` returns: one section, one object, or all of it.
 *
 * `--section intro` gives that section. With neither flag, it is the whole collection.
 * The mistake it can find: a section or object ID that isn't valid (`invalid-arguments`).
 */
export function checkReadScope(
  flags: Pick<FlagTextAsTyped, 'section' | 'object'>,
): Result<ReadScope> {
  if (flags.section !== undefined) {
    return checkSectionScope(flags.section);
  }
  if (flags.object !== undefined) {
    return checkObjectScope(flags.object);
  }
  return success({ kind: 'all' });
}

/**
 * Works out how a file changes a collection: `create`, `replace` or `patch`.
 *
 * The commands `create`, `replace` and `patch` are their own mode. Any other gets `--mode`, or
 * `create` when it wasn't typed. The mistake it can find: a `--mode` that isn't one of the three.
 */
export function checkChangeMode(
  name: CommandName,
  flags: Pick<FlagTextAsTyped, 'mode'>,
): Result<ChangeMode> {
  if (isChangeCommand(name)) {
    return success(name);
  }
  const modeText = flags.mode ?? defaultMode;
  if (!isChangeMode(modeText)) {
    return invalidModeFailure();
  }
  return success(modeText);
}

/**
 * Checks `--revision`, the revision of the collection the agent last read.
 *
 * `--revision 3` gives `{ revision: 3 }`. With no `--revision`, it gives `{}`.
 * The mistake it can find: anything but a whole number from 0 up, such as `-1` or `abc`.
 */
export function checkRevisionOption(
  flags: Pick<FlagTextAsTyped, 'revision'>,
): Result<RevisionOption> {
  if (flags.revision === undefined) {
    return success({});
  }
  const revision = checkRevision(flags.revision);
  if (!revision.ok) {
    return revision;
  }
  return success({ revision: revision.value });
}

/**
 * Checks the collection ID typed after `read` or `inspect`, such as `my-diagram`.
 *
 * The mistake it can find: an ID that isn't a letter followed by letters, digits, `_` or `-`.
 */
export function checkCollectionId(typedCollectionId: string): Result<CollectionId> {
  const collection = collectionId.safeParse(typedCollectionId);
  if (!collection.success) {
    return invalidCollectionIdFailure();
  }
  return success(collection.data);
}

/**
 * Checks a request ID, the name of one change the CLI sends, such as `req-1`.
 *
 * It is typed after `receipt`, `retry` or `apply`, or after `--request`.
 * The mistake it can find: an ID that isn't 1 to 120 letters, digits, `_`, `.`, `:` or `-`,
 * starting with a letter or digit (`invalid-request`).
 */
export function checkRequestId(typedRequestId: string): Result<RequestId> {
  const request = requestId.safeParse(typedRequestId);
  if (!request.success) {
    return invalidRequestIdFailure();
  }
  return success(request.data);
}

/**
 * Checks `--request`, the request ID the agent picks for the change the command sends.
 *
 * With no `--request`, it gives `{}`, and a new ID is made when the change is sent.
 * The mistake it can find: text that isn't a valid request ID (`invalid-request`).
 */
export function checkRequestOption(flags: Pick<FlagTextAsTyped, 'request'>): Result<RequestOption> {
  if (flags.request === undefined) {
    return success({});
  }
  const request = checkRequestId(flags.request);
  if (!request.ok) {
    return request;
  }
  return success({ request: request.value });
}

/**
 * Checks the file path typed after the command, such as `plan.canvas` in `create plan.canvas`.
 *
 * The file itself is read later.
 * The mistake it can find: an empty path (`source-unavailable`, as for a file that can't be read).
 */
export function checkFilePath(typedFilePath: string): Result<FilePath> {
  const path = filePath.safeParse(typedFilePath);
  if (!path.success) {
    return unreadableSourceFailure(typedFilePath);
  }
  return success(path.data);
}

/**
 * Checks `--out`, the file the command's answer is written to.
 *
 * With no `--out`, it gives `{}`, and the answer is printed instead.
 * The mistake it can find: an empty path (`output-unavailable`), found before anything is sent.
 */
export function checkOutOption(flags: Pick<FlagTextAsTyped, 'out'>): Result<OutOption> {
  if (flags.out === undefined) {
    return success({});
  }
  const out = filePath.safeParse(flags.out);
  if (!out.success) {
    return unwritableOutputFailure(flags.out);
  }
  return success({ out: out.data });
}

/**
 * Checks a profile ID as typed, such as `build-spec@1`.
 *
 * The mistake it can find: a profile the CLI doesn't know (`unknown-profile`).
 */
export function checkProfileId(typedProfileId: string): Result<ProfileId> {
  const profile = profileId.safeParse(typedProfileId);
  if (!profile.success) {
    return unknownProfileFailure(typedProfileId);
  }
  return success(profile.data);
}

/** Checks a `--section` ID, and limits the read to that section. */
function checkSectionScope(sectionText: string): Result<ReadScope> {
  const section = sectionId.safeParse(sectionText);
  if (!section.success) {
    return invalidScopeIdFailure();
  }
  return success({ kind: 'section', id: section.data });
}

/** Checks an `--object` ID, and limits the read to that object. */
function checkObjectScope(objectText: string): Result<ReadScope> {
  const object = objectId.safeParse(objectText);
  if (!object.success) {
    return invalidScopeIdFailure();
  }
  return success({ kind: 'object', id: object.data });
}

/** Checks `--revision` is digits only, and a whole number small enough to count exactly. */
function checkRevision(revisionText: string): Result<CollectionRevision> {
  if (!isDigitsOnly(revisionText)) {
    return invalidRevisionFailure();
  }
  const revision = collectionRevision.safeParse(Number(revisionText));
  if (!revision.success) {
    return invalidRevisionFailure();
  }
  return success(revision.data);
}

/** Whether the text is digits only, such as `3` (so not `-1`, `1.5` or `3e2`). */
function isDigitsOnly(revisionText: string): boolean {
  return digitsOnly.test(revisionText);
}

/** Whether the command is `create`, `replace` or `patch`: its name is also its change mode. */
function isChangeCommand(name: CommandName): name is 'create' | 'replace' | 'patch' {
  return isChangeMode(name);
}

/** Whether the text is one of the three change modes. */
function isChangeMode(modeText: string): modeText is ChangeMode {
  return Object.hasOwn(changeModes, modeText);
}

/** Makes the mistake for a `--mode` that isn't `create`, `replace` or `patch` (`invalid-mode`). */
function invalidModeFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-mode', message: 'Mode must be create, replace or patch' });
}

/** Makes the mistake for a `--revision` that isn't a whole number from 0 up. */
function invalidRevisionFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-revision',
    message: 'Revision must be a non-negative safe integer',
  });
}

/** Makes the mistake for a `--section` or `--object` ID that isn't valid (`invalid-arguments`). */
function invalidScopeIdFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Read scope IDs must be non-empty canonical IDs.',
  });
}

/** Makes the mistake for a collection ID that isn't valid (`invalid-arguments`). */
function invalidCollectionIdFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Collection IDs must be canonical IDs: a letter, then letters, digits, _ or -.',
  });
}

/** Makes the mistake for a request ID that isn't valid (`invalid-request`). */
function invalidRequestIdFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-request', message: 'Request ID is invalid' });
}

/** Makes the mistake for a profile the CLI doesn't know, naming it (`unknown-profile`). */
function unknownProfileFailure(typedProfileId: string): Result<never, LocalFailure> {
  return failure({
    code: 'unknown-profile',
    message: `Unknown profile: ${typedProfileId}`,
    recovery: 'Use build-spec@1.',
  });
}
