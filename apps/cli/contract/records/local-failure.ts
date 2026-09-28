/*
 * Why this file exists
 *
 * When the CLI finds a mistake itself, it reports a code, a message and what to do next. Two kinds
 * of mistake need one thing more, or the agent can't fix them:
 * - A font or image that can't be used says where the source declares it:
 *   `path-escape: walk.canvas:3:3 asset @logo: Resource escapes its source directory`.
 * - A source Language refused keeps Language's reasons, printed one per line. A stored collection
 *   Model refused keeps Model's reasons the same way.
 *
 * This file lists every code, and which of three shapes each code takes: plain, located (names the
 * declaration) or evidenced (keeps the reasons). So `invalid-command` can never carry a file
 * location, and `invalid-source` can never lose Language's reasons. It declares types only;
 * `errors.ts` builds them.
 */
import type { FilePath, ResourceAlias } from '../brands.js';
import type { FailureSource, SourcePosition, ThemeSourceCode } from './foreign.js';

/**
 * A mistake found on this machine, grouped by where it happens. The CLI finds all of them except
 * the last line, `ThemeSourceCode`: Templates' two `.theme` codes, passed on as written.
 */
export type LocalCode =
  // Typed wrong. Nothing was read or sent.
  | 'invalid-command' // No such command.
  | 'invalid-arguments' // A wrong flag, the wrong number of words, or a badly shaped value.
  | 'invalid-mode' // `--mode` isn't create, replace or patch.
  | 'invalid-revision' // `--revision` isn't a whole number from 0 up.
  | 'invalid-server' // `--server` isn't an `http://127.0.0.1` address.
  | 'invalid-request' // A typed request ID isn't one Authoring accepts.
  | 'unknown-profile' // The profile isn't `build-spec@1`.
  // Files on this machine.
  | 'source-unavailable' // A source, font or image file can't be read.
  | 'source-too-large' // The source file is over 16 MiB.
  | 'output-unavailable' // The `--out` file can't be written. The command already ran.
  // The request journal, where a request is saved before it is sent.
  | 'retention-unavailable' // The request couldn't be saved, so it wasn't sent.
  | 'request-unavailable' // The saved request is missing or can't be read.
  | 'request-reused' // The request ID is already saved for a different request.
  | 'journal-corrupt' // The saved file is damaged or holds another ID's request. Nothing was sent.
  // A font or image a source declares. The failure's `location` names the declaration.
  | 'absolute-path' // The path starts at the root of the disk.
  | 'path-escape' // The path leaves the source file's folder.
  | 'unsupported-media' // The file isn't a font or image type the CLI knows.
  | 'resource-mismatch' // A font declaration names an image file, or the reverse.
  | 'resource-too-large' // The file is over 16 MiB.
  // The source, and what a change needs.
  | 'invalid-source' // Language refused the source. The failure's `source` says why.
  | 'invalid-input' // A whole change request failed Authoring's check, built here or sent back.
  | 'not-found' // The collection to change doesn't exist.
  | 'already-exists' // The collection to create already exists.
  | 'revision-required' // `replace` or `patch` without `--revision`.
  | 'revision-conflict' // `--revision` isn't the collection's current revision.
  | 'profile-structure' // `profile lint` found problems. The message lists them.
  // Talking to the service.
  | 'connection-uncertain' // No sure answer. Check the receipt before trying again.
  | 'invalid-response' // An answer broke its own contract, such as an apply with no receipt.
  // The program itself.
  | 'cli-unavailable' // The CLI couldn't finish: an unexpected throw, or a bad fresh request ID.
  | 'render-unavailable' // render:png couldn't start.
  | ThemeSourceCode; // `invalid-theme` or `duplicate-token`.

/** The codes only a font or image read gives. Their failure always names the declaration. */
type ResourceCode =
  | 'absolute-path'
  | 'path-escape'
  | 'unsupported-media'
  | 'resource-mismatch'
  | 'resource-too-large';

/**
 * The codes of a failure that names a font or image declaration. `source-unavailable` takes this
 * shape when a declared file can't be read, and the plain one when a source or theme file can't.
 */
export type LocatedCode = ResourceCode | 'source-unavailable';

/**
 * The codes of a failure that keeps why another part refused. `invalid-response` takes this shape
 * when Model refuses a stored collection, and the plain one for any other broken answer.
 */
export type EvidencedCode = 'invalid-source' | 'invalid-response';

/**
 * The codes of a failure with only a message and what to do next: every code except the five font
 * and image codes and `invalid-source`, which always carry more.
 */
export type PlainCode = Exclude<LocalCode, ResourceCode | 'invalid-source'>;

/**
 * Where a source declares the font or image a failure is about. Printed before the message, as
 * `file:line:column asset @alias`. Lines and columns count from 1.
 */
export interface SourceLocation extends Pick<SourcePosition, 'line' | 'column'> {
  /** The `.canvas` or `.theme` file that declares the font or image. */
  readonly file: FilePath;
  /** The name the declaration gives the font or image. */
  readonly alias: ResourceAlias;
}

/** What every mistake the CLI found says: a message, and what to do next. */
interface FailureText {
  /** For people to read. Its wording may change, so code never branches on it. */
  readonly message: string;
  /** What to do next, such as "Correct the named input and retry." */
  readonly recovery: string;
}

/** A mistake with only its code, message and what to do next, such as `invalid-command`. */
export interface PlainFailure extends FailureText {
  readonly code: PlainCode;
}

/** A mistake about one font or image, naming where the source declares it. */
export interface LocatedFailure extends FailureText {
  readonly code: LocatedCode;
  /** Where the source declares the font or image. */
  readonly location: SourceLocation;
}

/** A mistake that keeps why Language, Model or the service refused, such as `invalid-source`. */
export interface EvidencedFailure extends FailureText {
  readonly code: EvidencedCode;
  /** Why they refused, kept whole (see `records/foreign.ts`). */
  readonly source: FailureSource;
}

/** A mistake the CLI found: plain, located or evidenced, as its code allows. */
export type LocalFailure = PlainFailure | LocatedFailure | EvidencedFailure;

/**
 * What the font and image reader gives back when it can't use a file: a code and a message. The
 * reader doesn't know which declaration asked for the file, so core adds that place later.
 */
export interface ResourceReadFailure {
  readonly code: LocatedCode;
  readonly message: string;
}
