/*
 * One check per argument value: read scope, change mode, revision, collection ID, request ID, file
 * path and profile. Each mints its brand once, from text the argument adapter passed through.
 * Pure. A rejected value is a failure naming the argument; nothing was read or sent, so the caller
 * corrects it and runs the command again.
 */
import {
  collectionId,
  collectionRevision,
  filePath,
  objectId,
  requestId,
  sectionId,
} from '../../contract/brands.js';
import type { CollectionId, FilePath, RequestId } from '../../contract/brands.js';
import { profileId } from '../../contract/records/profiles.js';
import type { ProfileId } from '../../contract/records/profiles.js';
import type {
  ChangeMode,
  CommandName,
  ReadScope,
  Retains,
  Revises,
  Writes,
} from '../../contract/records/command.js';
import type { CommandFlags } from '../../contract/records/arguments.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../shared/checks.js';
import { mapped } from '../shared/results.js';

/** Every change mode, keyed by itself. */
const changeModes: Readonly<Record<ChangeMode, ChangeMode>> = Object.freeze({
  create: 'create',
  replace: 'replace',
  patch: 'patch',
});

/**
 * --section or --object as a read scope; neither means the whole collection. Fails with
 * `invalid-arguments` when the ID is not a canonical ID.
 */
export function readScope(flags: Pick<CommandFlags, 'section' | 'object'>): Result<ReadScope> {
  if (flags.section !== undefined)
    return mapped(scopeId(sectionId, flags.section), (id) => ({ kind: 'section', id }));
  if (flags.object !== undefined)
    return mapped(scopeId(objectId, flags.object), (id) => ({ kind: 'object', id }));
  return success({ kind: 'all' });
}

/**
 * The change mode: `create`, `replace` and `patch` are their own mode; any other command checks
 * --mode. Fails with `invalid-mode`.
 */
export function changeMode(
  name: CommandName,
  text: string,
): Result<ChangeMode> {
  const selected = isChangeMode(name) ? name : text;
  if (!isChangeMode(selected))
    return failure({ code: 'invalid-mode', message: 'Mode must be create, replace or patch' });
  return success(selected);
}

/**
 * --revision: a whole number from 0 to `Number.MAX_SAFE_INTEGER`; absent stays absent. Fails with
 * `invalid-revision`.
 */
export function revises(text: string | undefined): Result<Revises> {
  if (text === undefined) return success({});
  const digits = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
  return mapped(
    checked(collectionRevision, digits, {
      code: 'invalid-revision',
      message: 'Revision must be a non-negative safe integer',
    }),
    (revision) => ({ revision }),
  );
}

/** A collection ID operand (`read`, `inspect`). Fails with `invalid-arguments`. */
export function collection(text: string): Result<CollectionId> {
  return checked(collectionId, text, {
    code: 'invalid-arguments',
    message: 'Collection IDs must be canonical IDs: a letter, then letters, digits, _ or -.',
  });
}

/** A request ID operand (`receipt`, `retry`, `apply`) or --request. Fails with `invalid-request`. */
export function request(text: string): Result<RequestId> {
  return checked(requestId, text, { code: 'invalid-request', message: 'Request ID is invalid' });
}

/** --request; absent stays absent and a fresh ID is minted later. Fails with `invalid-request`. */
export function retains(flags: Pick<CommandFlags, 'request'>): Result<Retains> {
  if (flags.request === undefined) return success({});
  return mapped(request(flags.request), (id) => ({ request: id }));
}

/**
 * A FILE operand. Only an empty path fails here, with the failure its read would give:
 * `source-unavailable`.
 */
export function sourceFile(text: string): Result<FilePath> {
  return checked(filePath, text, {
    code: 'source-unavailable',
    message: `Cannot read UTF-8 source: ${text}`,
  });
}

/**
 * --out; absent stays absent. An empty path fails with `output-unavailable`, the failure its write
 * would give, before the command runs.
 */
export function writes(flags: Pick<CommandFlags, 'out'>): Result<Writes> {
  if (flags.out === undefined) return success({});
  const out = flags.out;
  return mapped(
    checked(filePath, out, { code: 'output-unavailable', message: `Cannot write output: ${out}` }),
    (path) => ({ out: path }),
  );
}

/** A profile operand or --profile. Fails with `unknown-profile`. */
export function profile(text: string): Result<ProfileId> {
  return checked(profileId, text, {
    code: 'unknown-profile',
    message: `Unknown profile: ${text}`,
    recovery: 'Use build-spec@1.',
  });
}

/** A --section or --object ID. Fails with `invalid-arguments`. */
function scopeId<T>(
  parser: Parser<T>,
  text: string,
): Result<T> {
  return checked(parser, text, {
    code: 'invalid-arguments',
    message: 'Read scope IDs must be non-empty canonical IDs.',
  });
}

/** Whether `text` is one of the three change modes. */
function isChangeMode(text: string): text is ChangeMode {
  return Object.hasOwn(changeModes, text);
}
