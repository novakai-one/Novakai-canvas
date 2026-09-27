/*
 * The CLI's failure vocabulary: closed codes, the two failure shapes and the Result helpers every
 * layer returns. Pure. Nothing throws across a boundary; `cli/canvas.ts` prints the failure and
 * sets the exit code. Consumers branch on the code, never on the message.
 */
import type { FailureSource, OperationSource } from './records/foreign.js';

/**
 * A failure the CLI found itself.
 *
 * Arguments (nothing was read or sent; an empty FILE or --out path reports the local-file code its
 * read or write would give):
 * - `invalid-command`: no such command.
 * - `invalid-arguments`: an unknown flag, a wrong operand count, a flag the command does not
 *   take, or a missing or malformed operand or flag value (collection ID, recipe header, pin).
 * - `invalid-mode`: `--mode` is not create, replace or patch.
 * - `invalid-revision`: `--revision` is not a non-negative safe integer.
 * - `invalid-server`: `--server` is not an `http://127.0.0.1` origin.
 * - `invalid-request`: a request ID operand or `--request` is not a valid Authoring request ID.
 * - `unknown-profile`: the profile is not `build-spec@1`.
 *
 * Local files:
 * - `source-unavailable`: a source or resource file cannot be opened or read as UTF-8.
 * - `source-too-large`: the source file is over 16 MiB.
 * - `output-unavailable`: the `--out` file cannot be written. The command already ran, unless the
 *   path was empty.
 *
 * Request journal:
 * - `retention-unavailable`: the request could not be retained. Nothing was sent.
 * - `request-unavailable`: the retained request cannot be read.
 * - `request-reused`: the request ID is already retained for a different request.
 *
 * Resources (the message starts with `file:line:column asset @alias`):
 * - `absolute-path`: the resource path is absolute.
 * - `path-escape`: the resource path leaves the source file's directory.
 * - `unsupported-media`: the file extension is not a supported font or image type.
 * - `resource-mismatch`: a font declaration names an image file, or the reverse.
 * - `resource-too-large`: the resource file is over 16 MiB.
 *
 * Source and preconditions:
 * - `invalid-source`: Language rejected the source; `source` holds its diagnostics.
 * - `invalid-input`: an Authoring request failed its schema. Two sources: the request the CLI
 *   built from the source, or the request the service's `/resources/freeze` answer returned. The
 *   second is a bad service answer, not a user input error.
 * - `not-found`: the collection to change does not exist.
 * - `already-exists`: the collection to create already exists.
 * - `revision-required`: replace or patch without `--revision`.
 * - `revision-conflict`: `--revision` is not the collection's current revision.
 *
 * Themes: `invalid-theme` (the file does not match the theme grammar), `duplicate-token` (one
 * token set twice). Profiles: `profile-structure` (lint findings, listed in the message).
 *
 * Transport:
 * - `connection-uncertain`: no confirmed answer. Check the receipt before retrying.
 * - `invalid-response`: a service answer did not match its schema or lacks what the command
 *   needs, such as a committed receipt; or the service's credential reader returned no token.
 *
 * Setup: `cli-unavailable` and `render-unavailable` (an unexpected throw at the entry point).
 */
export type LocalCode =
  | 'invalid-command'
  | 'invalid-arguments'
  | 'invalid-mode'
  | 'invalid-revision'
  | 'invalid-server'
  | 'invalid-request'
  | 'unknown-profile'
  | 'source-unavailable'
  | 'source-too-large'
  | 'output-unavailable'
  | 'retention-unavailable'
  | 'request-unavailable'
  | 'request-reused'
  | 'absolute-path'
  | 'path-escape'
  | 'unsupported-media'
  | 'resource-mismatch'
  | 'resource-too-large'
  | 'invalid-source'
  | 'invalid-input'
  | 'not-found'
  | 'already-exists'
  | 'revision-required'
  | 'revision-conflict'
  | 'invalid-theme'
  | 'duplicate-token'
  | 'profile-structure'
  | 'connection-uncertain'
  | 'invalid-response'
  | 'cli-unavailable'
  | 'render-unavailable';

/**
 * A failure another owner wrote, kept whole in `foreign`.
 * - `service-rejected`: the service answered with a failure.
 * - `credential-unavailable`: the service's credential reader could not read the agent credential.
 */
export type ForeignCode = 'service-rejected' | 'credential-unavailable';

/** Every code a CLI failure can carry. */
export type CliErrorCode = LocalCode | ForeignCode;

/** A failure the CLI found. */
export interface LocalFailure {
  readonly code: LocalCode;
  /** Human-readable. Its wording is not part of the contract. */
  readonly message: string;
  /** What to do next. */
  readonly recovery: string;
  /** Language, Model or service evidence, kept whole. */
  readonly source?: FailureSource;
}

/** A service failure record, printed exactly as the service wrote it. */
export interface ForeignFailure {
  readonly code: ForeignCode;
  readonly foreign: OperationSource;
}

/** Any CLI failure. */
export type CliFailure = LocalFailure | ForeignFailure;

/** The CLI's own success-or-failure envelope. A failure never carries a partial value. */
export type Result<T, E = CliFailure> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** What `failure` needs. `recovery` may be omitted. */
export type FailureInput = Omit<LocalFailure, 'recovery'> & { readonly recovery?: string };

const correctAndRetry = 'Correct the named input and retry.';

/** Wraps a successful value. */
export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Builds a local failure. `recovery` defaults to 'Correct the named input and retry.'; an absent
 * `source` stays absent.
 */
export function failure(input: FailureInput): Result<never, LocalFailure> {
  const { code, message, recovery = correctAndRetry, source } = input;
  if (source === undefined) return { ok: false, error: { code, message, recovery } };
  return { ok: false, error: { code, message, recovery, source } };
}

/**
 * `source-unavailable` naming `path`: the FILE cannot be read as UTF-8 text. Core's FILE check (an
 * empty path) and the local-files read report the same text.
 */
export function unreadableSource(path: string): FailureInput {
  return { code: 'source-unavailable', message: `Cannot read UTF-8 source: ${path}` };
}

/**
 * `output-unavailable` naming `path`: the --out file cannot be written. Core's --out check (an
 * empty path) and the local-files write report the same text.
 */
export function unwritableOutput(path: string): FailureInput {
  return { code: 'output-unavailable', message: `Cannot write output: ${path}` };
}

/** Wraps another owner's failure record without changing it. */
export function rejected(
  code: ForeignCode,
  foreign: OperationSource,
): Result<never, ForeignFailure> {
  return { ok: false, error: { code, foreign } };
}
