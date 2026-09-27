/*
 * Checked IDs and scalars the CLI speaks in. Capability brands are re-exported, never copied, so
 * core reaches them without importing a package. Each CLI brand names the one place that mints
 * it and the failure code a rejected value becomes there. Pure declarations; the caller corrects
 * the named input and runs the command again.
 */
import { z } from 'zod';
import type { collectionId } from '@novakai/canvas-model';

export { requestId, workspaceId } from '@novakai/canvas-authoring';
export type { RequestId, WorkspaceId } from '@novakai/canvas-authoring';
export { collectionId, sectionId, objectId } from '@novakai/canvas-model';
export type { SectionId, ObjectId } from '@novakai/canvas-model';
/** Model's pinned content identity, `sha256:` then 64 lowercase hex digits (syntax only, unbranded). */
export { digest as pinnedDigest } from '@novakai/canvas-model';
export { presetId, version, digest as presetDigest } from '@novakai/canvas-templates';
export type { PresetId, Version, Digest as PresetDigest } from '@novakai/canvas-templates';
export { digest as assetDigest } from '@novakai/canvas-assets';
export type { Digest as AssetDigest } from '@novakai/canvas-assets';
export { chromeName } from '@novakai/canvas-design-system';
export type { ChromeName } from '@novakai/canvas-design-system';

/**
 * A local file path: any non-empty text. Node resolves it against the working directory; the
 * resource reader enforces confinement. Minted from a FILE operand (`source-unavailable`), --out
 * (`output-unavailable`) and --workspace (an empty one becomes `.`) by core's argument checks, by
 * the render's file adapter, and by render:png's option check.
 */
export const filePath = z.string().min(1).brand<'CliFilePath'>();

/**
 * The service origin: `http://127.0.0.1[:port]` only, with no path, query, hash or user info. The
 * agent token is sent nowhere else. Minted from --server by core's argument checks
 * (`invalid-server`), before the credential is read.
 */
export const loopbackOrigin = z
  .string()
  .refine(isLoopbackOrigin)
  .transform(originOf)
  .pipe(z.string().brand<'LoopbackOrigin'>());

/** The agent's bearer token from the workspace credential. Minted by compose (`invalid-response`). */
export const agentToken = z.string().min(1).brand<'AgentToken'>();

/**
 * The service generation an answer came from; a retained request replays under the newest one.
 * Minted by the HTTP transport (`invalid-response`). The request journal does not mint it: a
 * journal read returns no generation.
 */
export const generation = z.string().min(1).max(128).brand<'ServiceGeneration'>();

/**
 * A collection revision the agent read: a whole number from 0 to `Number.MAX_SAFE_INTEGER`.
 * Minted from `--revision` by core's argument checks (`invalid-revision`).
 */
export const collectionRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<'CollectionRevision'>();

/**
 * render:png's `--collection` text: a recipe ID, a `.canvas` path or a shipped collection ID.
 * Minted by render:png's option check.
 */
export const collectionName = z.string().min(1).brand<'CollectionName'>();

/** render:png's `--theme` text: a theme ID. Minted by render:png's option check. */
export const themeName = z.string().min(1).brand<'ThemeName'>();

/** A collection ID that passed Model's `collectionId`. Model exports the schema, not the type. */
export type CollectionId = z.infer<typeof collectionId>;

/** A path that passed {@link filePath}. */
export type FilePath = z.infer<typeof filePath>;

/** An origin that passed {@link loopbackOrigin}. */
export type LoopbackOrigin = z.infer<typeof loopbackOrigin>;

/** A token that passed {@link agentToken}. */
export type AgentToken = z.infer<typeof agentToken>;

/** A generation that passed {@link generation}. */
export type Generation = z.infer<typeof generation>;

/** A revision that passed {@link collectionRevision}. */
export type CollectionRevision = z.infer<typeof collectionRevision>;

/** A collection selector that passed {@link collectionName}. */
export type CollectionName = z.infer<typeof collectionName>;

/** A theme selector that passed {@link themeName}. */
export type ThemeName = z.infer<typeof themeName>;

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
