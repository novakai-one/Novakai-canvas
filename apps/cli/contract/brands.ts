/*
 * Why this file exists
 *
 * Everything an agent types is plain text, and plain text can be anything. `--revision 3` has to
 * become a real revision number, and `--server` has to point at this machine, or the agent's
 * secret token could be sent somewhere else. Once a value is checked, its type says so: a
 * `CollectionRevision` is a checked number, never just any number.
 *
 * This file declares those checked types and the checks that make them. Types another part owns,
 * such as Model's `CollectionId`, are passed on from their owner, never copied. It never runs a
 * check itself; the checks of typed commands and service answers call these.
 */
import { z } from 'zod';
import type { assetId, collectionId } from '@novakai/canvas-model';
import { profileIds } from '@novakai/canvas-language';

export { recordId, requestId, workspaceId } from '@novakai/canvas-authoring';
export type { RecordId, RequestId, WorkspaceId } from '@novakai/canvas-authoring';
export { assetId, collectionId, sectionId, objectId } from '@novakai/canvas-model';
export type { SectionId, ObjectId } from '@novakai/canvas-model';
/** Checks Model's content pin: `sha256:` then 64 lowercase hex digits. Gives plain text back. */
export { digest as pinnedDigest } from '@novakai/canvas-model';
export { presetId, version, digest as presetDigest } from '@novakai/canvas-templates';
export type { PresetId, Version, Digest as PresetDigest } from '@novakai/canvas-templates';
export { digest as assetDigest } from '@novakai/canvas-assets';
export type { Digest as AssetDigest } from '@novakai/canvas-assets';
/** A collection profile Language knows, such as `build-spec@1`. Language owns the profiles. */
export type { ProfileId } from '@novakai/canvas-language';

/** Checks a profile name against the profiles Language knows, such as `build-spec@1`. */
export const profileId = z.enum(profileIds);

/**
 * Checks a file or folder path on this machine: any text that isn't empty. A relative path is
 * taken from the folder the command runs in. Nothing is opened here.
 */
export const filePath = z.string().min(1).brand<'CliFilePath'>();

/**
 * Checks the `--server` address: `http://127.0.0.1`, with or without a port, and nothing else.
 * The agent's token is sent only there, so any other address is refused.
 */
export const loopbackOrigin = z
  .string()
  .refine(isLoopbackOrigin)
  .transform(originOf)
  .pipe(z.string().brand<'LoopbackOrigin'>());

/** Checks the agent's secret token, read from the workspace's credential file. Not empty. */
export const agentToken = z.string().min(1).brand<'AgentToken'>();

/**
 * Checks a service generation: a label (1 to 128 characters) the service makes each time it
 * starts. Every answer carries one, and a saved request is sent again under the newest one.
 */
export const generation = z.string().min(1).max(128).brand<'ServiceGeneration'>();

/**
 * Checks a collection's revision as Model counts it: a whole number from 0 up. `--revision 3` and
 * the revision the service stored both pass through here, so the two compare directly.
 */
export const collectionRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<'CollectionRevision'>();

/**
 * Checks a saved record's storage version as Authoring counts it: a whole number from 0 up.
 * Authoring has no check of its own to share, so it lives here.
 */
export const storageVersion = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<'StorageVersion'>();

/**
 * Checks render:png's `--collection` when it isn't a `.canvas` file: a recipe ID or the ID of a
 * collection that ships with the repo. Text that isn't empty; the render looks the name up.
 */
export const collectionName = z.string().min(1).brand<'CollectionName'>();

/** Checks render:png's `--theme`: a theme ID, as text that isn't empty. The render looks it up. */
export const themeName = z.string().min(1).brand<'ThemeName'>();

/**
 * Checks the name a source gives one font or image, such as `@logo` in a `.canvas` file or a font
 * role in a `.theme` file: text that isn't empty.
 */
export const resourceAlias = z.string().min(1).brand<'ResourceAlias'>();

/**
 * Checks where a hand-placed object or hand-drawn wire sits, as the service prints it, such as
 * `@section/@object`. Any text; the CLI only passes it on.
 */
export const manualAddress = z.string().brand<'ManualAddress'>();

/** A collection ID that passed Model's `collectionId`. Model shares the check, not the type. */
export type CollectionId = z.infer<typeof collectionId>;

/** A font or image ID that passed Model's `assetId` check. Model shares the check, not the type. */
export type AssetId = z.infer<typeof assetId>;

/** A file or folder path that passed {@link filePath}: text that isn't empty. */
export type FilePath = z.infer<typeof filePath>;

/** A `--server` address that passed {@link loopbackOrigin}: always on this machine. */
export type LoopbackOrigin = z.infer<typeof loopbackOrigin>;

/** The agent's secret token, checked by {@link agentToken}. */
export type AgentToken = z.infer<typeof agentToken>;

/** A service generation, checked by {@link generation}: the label of one service start. */
export type Generation = z.infer<typeof generation>;

/** A collection revision, checked by {@link collectionRevision}: a whole number from 0 up. */
export type CollectionRevision = z.infer<typeof collectionRevision>;

/** A saved record's storage version, checked by {@link storageVersion}. */
export type StorageVersion = z.infer<typeof storageVersion>;

/** render:png's collection name, checked by {@link collectionName}: a recipe or collection ID. */
export type CollectionName = z.infer<typeof collectionName>;

/** render:png's theme ID, checked by {@link themeName}. */
export type ThemeName = z.infer<typeof themeName>;

/** The name a source gives one font or image, checked by {@link resourceAlias}. */
export type ResourceAlias = z.infer<typeof resourceAlias>;

/** Where a hand-placed object or wire sits, checked by {@link manualAddress}. */
export type ManualAddress = z.infer<typeof manualAddress>;

/** Whether `text` parses as a URL that is exactly an `http://127.0.0.1` origin. */
function isLoopbackOrigin(text: string): boolean {
  if (!URL.canParse(text)) return false;
  return isOriginOnly(new URL(text));
}

/** Plain HTTP to 127.0.0.1, any port; a path, query, hash or user info is refused. */
function isOriginOnly(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

/** The origin of a URL {@link isLoopbackOrigin} accepted. */
function originOf(text: string): string {
  return new URL(text).origin;
}
