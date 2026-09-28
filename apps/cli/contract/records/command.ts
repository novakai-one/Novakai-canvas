/*
 * Why this file exists
 *
 * Once a typed line is checked, the rest of the CLI should never look at the raw text again. For
 * `pnpm canvas read my-diagram --section intro`, the command becomes
 * `{ name: 'read', collection: 'my-diagram', scope: { kind: 'section', id: 'intro' } }`.
 *
 * This file names that checked command: one shape per command, holding only what that command
 * uses, each value already a checked type. It never checks anything itself;
 * `core/commands/parse.ts` builds these from the typed line.
 */
import type {
  CollectionId,
  CollectionRevision,
  FilePath,
  LoopbackOrigin,
  ObjectId,
  PresetId,
  ProfileId,
  RequestId,
  SectionId,
  Version,
} from '../brands.js';
import type { ExpansionRequest, RecipeFamily } from './foreign.js';

/** How a source file changes a collection: make a new one, replace it whole, or patch it. */
export type ChangeMode = 'create' | 'replace' | 'patch';

/** What `read` prints: a whole collection, or one section (`--section`) or object (`--object`). */
export type ReadScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'section'; readonly id: SectionId }
  | { readonly kind: 'object'; readonly id: ObjectId };

/** `--out`: write the answer to this file instead of printing it. Left out, it prints. */
export interface OutOption {
  readonly out?: FilePath;
}

/**
 * `--request`: the request ID to send the change under, so a script can look up its receipt.
 * Left out, the CLI makes a fresh one.
 */
export interface RequestOption {
  readonly request?: RequestId;
}

/**
 * `--revision`: the revision the agent last read, so a change can't overwrite a newer one.
 * `replace` and `patch` refuse to run without it (`revision-required`).
 */
export interface RevisionOption {
  readonly revision?: CollectionRevision;
}

/**
 * What `recipe admit` saves a recipe under: its `--id`, `--version`, `--family` and `--title`.
 * Templates stores saved themes and recipes as presets, so the ID and version are a preset's.
 */
export interface RecipeHeader {
  readonly id: PresetId;
  /** Such as `1.0.0`. */
  readonly version: Version;
  readonly family: RecipeFamily;
  readonly title: string;
}

/** A command that needs the local service: to read collections, or to change or save something. */
export type ServiceCommand =
  | ({ readonly name: 'describe' | 'list' } & OutOption)
  | ({
      readonly name: 'read';
      readonly collection: CollectionId;
      readonly scope: ReadScope;
    } & OutOption)
  | ({ readonly name: 'inspect'; readonly collection: CollectionId } & OutOption)
  /**
   * Each takes the ID of a request the CLI kept in its journal. `receipt` shows whether it was
   * saved. `retry` sends it again. `apply` saves a request that `preview` kept. Neither sends one
   * already saved.
   */
  | ({ readonly name: 'receipt' | 'retry' | 'apply'; readonly request: RequestId } & OutOption)
  | ({ readonly name: 'create'; readonly file: FilePath } & RequestOption & OutOption)
  | ({ readonly name: 'theme-admit'; readonly file: FilePath } & RequestOption & OutOption)
  | ({ readonly name: 'replace' | 'patch'; readonly file: FilePath } & RevisionOption &
      RequestOption &
      OutOption)
  | ({
      readonly name: 'preview';
      readonly file: FilePath;
      readonly mode: ChangeMode;
    } & RevisionOption &
      RequestOption &
      OutOption)
  | ({
      readonly name: 'recipe-admit';
      readonly file: FilePath;
      readonly recipe: RecipeHeader;
    } & RequestOption &
      OutOption)
  /**
   * `recipe instantiate` copies a saved recipe out as source for a new collection. `expansion`
   * holds which recipe, and the new collection's ID (`--namespace`).
   */
  | ({ readonly name: 'recipe-instantiate'; readonly expansion: ExpansionRequest } & OutOption);

/**
 * A `profile` command. A profile is a set of rules a collection follows, such as `build-spec@1`.
 * These run on this machine alone and never talk to the service.
 */
export type ProfileCommand =
  | ({ readonly name: 'profile-describe'; readonly profile: ProfileId } & OutOption)
  | ({
      readonly name: 'profile-scaffold';
      readonly profile: ProfileId;
      readonly collection: CollectionId;
      readonly title: string;
    } & OutOption)
  | ({
      readonly name: 'profile-lint';
      readonly profile: ProfileId;
      readonly file: FilePath;
    } & OutOption);

/** Any `pnpm canvas` command, checked. */
export type Command = { readonly name: 'help' } | ServiceCommand | ProfileCommand;

/** A command's name. Two-word commands are joined with a dash: `recipe admit` is `recipe-admit`. */
export type CommandName = Command['name'];

/** The commands that send one source file to Authoring to change a collection. */
export type ChangeCommand = Extract<
  ServiceCommand,
  { readonly name: 'create' | 'replace' | 'patch' | 'preview' }
>;

/** The commands that save one theme or recipe file for reuse. */
export type AdmitCommand = Extract<
  ServiceCommand,
  { readonly name: 'theme-admit' | 'recipe-admit' }
>;

/**
 * A change's mode, with what Authoring (the service's part that saves changes) must check first:
 * for `create`, that the collection doesn't exist yet; otherwise, the revision the agent read.
 */
export type ChangeIntent =
  { readonly mode: 'create' } | ({ readonly mode: 'replace' | 'patch' } & RevisionOption);

/** Where a service command is sent (`--server`), and the workspace it uses (`--workspace`). */
export interface ServerAndWorkspace {
  /** `--server`: the service's address, always `http://127.0.0.1` on this machine. */
  readonly server: LoopbackOrigin;
  /** `--workspace`: the folder holding the agent's credential and the saved requests. */
  readonly workspace: FilePath;
}

/**
 * A checked command, sorted by what it needs to run: nothing (`help`), this machine alone
 * (`profile`), or the service (`service`, with where to send it).
 */
export type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'profile'; readonly command: ProfileCommand }
  | {
      readonly kind: 'service';
      readonly command: ServiceCommand;
      /** `--server` and `--workspace`, checked. */
      readonly options: ServerAndWorkspace;
    };
