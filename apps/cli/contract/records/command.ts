/*
 * The parsed `pnpm canvas` command: one union member per command, carrying only the fields that
 * command reads, each already checked and branded. Pure declarations. Core's grammar
 * (`core/commands/parse.ts`) builds it from argv; compose routes on `ParsedCommand.kind`.
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

/** How a DSL source changes a collection. */
export type ChangeMode = 'create' | 'replace' | 'patch';

/** What `read` returns: the whole collection, or one section or object as read-only context. */
export type ReadScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'section'; readonly id: SectionId }
  | { readonly kind: 'object'; readonly id: ObjectId };

/** `--out`: write the text answer to this file instead of stdout. */
export interface Writes {
  readonly out?: FilePath;
}

/** `--request`: a fixed request ID for scripted receipt lookup. Absent: a fresh one is minted. */
export interface Retains {
  readonly request?: RequestId;
}

/** `--revision`: the collection revision the agent read. Absent on replace or patch: `revision-required`. */
export interface Revises {
  readonly revision?: CollectionRevision;
}

/** `recipe admit`'s `--id --version --family --title`. */
export interface RecipeHeader {
  readonly id: PresetId;
  readonly version: Version;
  readonly family: RecipeFamily;
  readonly title: string;
}

/** A command the local service answers. */
export type ServiceCommand =
  | ({ readonly name: 'describe' | 'list' } & Writes)
  | ({
      readonly name: 'read';
      readonly collection: CollectionId;
      readonly scope: ReadScope;
    } & Writes)
  | ({ readonly name: 'inspect'; readonly collection: CollectionId } & Writes)
  | ({ readonly name: 'receipt' | 'retry' | 'apply'; readonly request: RequestId } & Writes)
  | ({ readonly name: 'create'; readonly file: FilePath } & Retains & Writes)
  | ({ readonly name: 'theme-admit'; readonly file: FilePath } & Retains & Writes)
  | ({ readonly name: 'replace' | 'patch'; readonly file: FilePath } & Revises & Retains & Writes)
  | ({ readonly name: 'preview'; readonly file: FilePath; readonly mode: ChangeMode } & Revises &
      Retains &
      Writes)
  | ({
      readonly name: 'recipe-admit';
      readonly file: FilePath;
      readonly recipe: RecipeHeader;
    } & Retains &
      Writes)
  | ({ readonly name: 'recipe-instantiate'; readonly expansion: ExpansionRequest } & Writes);

/** A local build-spec profile command. Each writes its text answer to `--out` when given. */
export type ProfileCommand =
  | ({ readonly name: 'profile-describe'; readonly profile: ProfileId } & Writes)
  | ({
      readonly name: 'profile-scaffold';
      readonly profile: ProfileId;
      readonly collection: CollectionId;
      readonly title: string;
    } & Writes)
  | ({
      readonly name: 'profile-lint';
      readonly profile: ProfileId;
      readonly file: FilePath;
    } & Writes);

/** Any `pnpm canvas` command. */
export type Command = { readonly name: 'help' } | ServiceCommand | ProfileCommand;

/** A command word, after the family words (`theme`, `recipe`, `profile`) are joined to theirs. */
export type CommandName = Command['name'];

/** The commands that send one DSL source to Authoring. */
export type ChangeCommand = Extract<
  ServiceCommand,
  { readonly name: 'create' | 'replace' | 'patch' | 'preview' }
>;

/** The commands that admit one preset file. */
export type AdmitCommand = Extract<
  ServiceCommand,
  { readonly name: 'theme-admit' | 'recipe-admit' }
>;

/**
 * What a DSL change asks Authoring to check: `create` needs the collection absent; `replace` and
 * `patch` need the revision the agent read.
 */
export type ChangeIntent =
  { readonly mode: 'create' } | ({ readonly mode: 'replace' | 'patch' } & Revises);

/** Where service commands are sent. */
export interface ServiceOptions {
  /** `--server`: the service's loopback origin. */
  readonly server: LoopbackOrigin;
  /** `--workspace`: the directory holding the agent credential and the `requests` journal. */
  readonly workspace: FilePath;
}

/** The command and what it needs. Compose binds ports by `kind`; routing is decided once, here. */
export type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'profile'; readonly command: ProfileCommand }
  | {
      readonly kind: 'service';
      readonly command: ServiceCommand;
      readonly options: ServiceOptions;
    };
