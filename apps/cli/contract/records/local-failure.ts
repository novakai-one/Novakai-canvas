/*
 * A failure the CLI found itself: its closed codes, and the three shapes its code decides. Plain
 * failures carry a message and recovery; located ones also name one resource declaration;
 * evidenced ones keep another owner's diagnostics whole. Data only; errors.ts builds them. The
 * caller branches on the code, never on the message, fixes the named input and runs the command
 * again.
 */
import type { FilePath, ResourceAlias } from '../brands.js';
import type { FailureSource, SourcePosition } from './foreign.js';

/**
 * Every code a failure the CLI found itself can carry. Which shape each code takes is below.
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
 * - `retention-unavailable`: the request could not be retained. No Authoring request is sent.
 * - `request-unavailable`: the retained request file is missing or cannot be read.
 * - `request-reused`: the request ID is already retained for a different request.
 * - `journal-corrupt`: the request ID's retained file reads, but is not JSON, not a journal
 *   record, or another request ID's record. No Authoring request is sent; check the ID's receipt
 *   before authoring again under a new ID.
 *
 * Resources (the failure is located: `location` names the declaration, printed before the
 * message; `source-unavailable` is located only for a resource file):
 * - `absolute-path`: the resource path is absolute.
 * - `path-escape`: the resource path leaves the source file's directory.
 * - `unsupported-media`: the file extension is not a supported font or image type.
 * - `resource-mismatch`: a font declaration names an image file, or the reverse.
 * - `resource-too-large`: the resource file is over 16 MiB.
 *
 * Source and preconditions:
 * - `invalid-source`: Language rejected the source; `source` always holds its diagnostics.
 * - `invalid-input`: an Authoring request failed its schema. Two sources: the request the CLI
 *   built from the source, or the request the service's `/resources/freeze` answer returned. The
 *   second is a bad service answer, not a user input error.
 * - `not-found`: the collection to change does not exist.
 * - `already-exists`: the collection to create already exists.
 * - `revision-required`: replace or patch without `--revision`.
 * - `revision-conflict`: `--revision` is not the collection's current revision.
 *
 * Themes: `invalid-theme` (the file does not match the theme grammar, or its header @id or version
 * is not a Templates preset ID or version), `duplicate-token` (one token set twice). Profiles:
 * `profile-structure` (lint findings, listed in the message).
 *
 * Transport:
 * - `connection-uncertain`: no confirmed answer. Check the receipt before retrying.
 * - `invalid-response`: an owner's answer broke its own contract. A service answer did not match
 *   its schema or lacks what the command needs, such as a committed receipt; the service's
 *   credential reader returned no token; or Language's parse gave an empty resource alias or an
 *   asset alias that is not Model's asset ID. When a stored collection fails Model's check,
 *   `source` holds Model's diagnostics.
 *
 * Setup: `cli-unavailable` and `render-unavailable` (an unexpected throw at the entry point).
 *   `cli-unavailable` also reports a fresh request ID that fails Authoring's grammar; nothing was
 *   sent.
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
  | 'journal-corrupt'
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

/** The codes only a resource read gives: their failure always names the declaration. */
type ResourceOnlyCode =
  | 'absolute-path'
  | 'path-escape'
  | 'unsupported-media'
  | 'resource-mismatch'
  | 'resource-too-large';

/** The codes of a failure that names one resource declaration in `location`. */
export type LocatedCode = ResourceOnlyCode | 'source-unavailable';

/** The codes of a failure that keeps another owner's evidence in `source`. */
export type EvidenceCode = 'invalid-source' | 'invalid-response';

/** The codes of a failure with only a message and recovery. `invalid-source` has evidence. */
export type PlainCode = Exclude<LocalCode, ResourceOnlyCode | 'invalid-source'>;

/**
 * Where a source declares the font or image a failure is about: the file, Language's 1-based line
 * and column, and the alias. Printed as `file:line:column asset @alias` before the message.
 */
export interface SourceLocation extends Pick<SourcePosition, 'line' | 'column'> {
  /** The DSL or theme file that declares the resource. */
  readonly file: FilePath;
  /** The name the declaration gives the resource. */
  readonly alias: ResourceAlias;
}

/** What every local failure says. */
interface FailureText {
  /** Human-readable. Its wording is not part of the contract. */
  readonly message: string;
  /** What to do next. */
  readonly recovery: string;
}

/** A failure with nothing but its code, message and recovery. */
export interface PlainFailure extends FailureText {
  readonly code: PlainCode;
}

/** A failure about one font or image declaration, which `location` names. */
export interface LocatedFailure extends FailureText {
  readonly code: LocatedCode;
  readonly location: SourceLocation;
}

/** A failure that keeps Language, Model or service evidence whole in `source`. */
export interface EvidencedFailure extends FailureText {
  readonly code: EvidenceCode;
  readonly source: FailureSource;
}

/** A failure the CLI found: plain, located or evidenced, as its code allows. */
export type LocalFailure = PlainFailure | LocatedFailure | EvidencedFailure;

/**
 * A font or image file the resource reader could not use, before core adds the declaration's
 * location: a located code and its message. Its recovery is always the default one.
 */
export interface UnreadResource {
  readonly code: LocatedCode;
  readonly message: string;
}
