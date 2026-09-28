/*
 * Why this file exists
 *
 * The service passes around many values that are plain text or numbers underneath: a port, a folder
 * path, a render job ID, a secret token. As plain `string`s, one could be passed where another
 * belongs and nothing would notice.
 *
 * A brand fixes that: a type only a check can make. `hostPath.parse('/tmp/ws')` gives a `HostPath`;
 * a plain string is not one. This file declares the service's own brands, each with the one place
 * that makes it, and passes on the capabilities' ID types. It also adds and removes the `sha256:`
 * prefix Model puts on digests (file fingerprints), which Assets, Templates and Authoring leave
 * off.
 *
 * It never reads or writes anything.
 */
import { z } from 'zod';
import type { collectionId } from '@novakai/canvas-model';
import type { Digest as AssetDigest } from '@novakai/canvas-assets';
import type { Digest as PresetDigest } from '@novakai/canvas-templates';
import type { Digest as AuthoringDigest } from '@novakai/canvas-authoring';

export type { WorkspaceId, PlannerId, ActorId, Timestamp } from '@novakai/canvas-authoring';
export type { SectionId, ObjectId } from '@novakai/canvas-model';
export type { AssetDigest, PresetDigest, AuthoringDigest };

/** 64 lowercase hex characters: what both service secrets look like. */
const HEX_64 = /^[a-f0-9]{64}$/;

/**
 * A checked Model collection ID. Model exports only the check, so the type is taken from it here.
 */
export type CollectionId = z.infer<typeof collectionId>;

/**
 * Checks a generation: 1–128 characters. A generation is a random label made each time the server
 * starts (adapters/credentials). Every change request carries it, so a request made before a
 * restart is refused (`conflict`) instead of landing on the restarted workspace. Also checked in
 * every HTTP answer.
 */
export const generation = z.string().min(1).max(128).brand<'TransportGeneration'>();

/**
 * Checks the browser's session secret: 64 lowercase hex characters. Made by adapters/credentials
 * each time the server starts, and sent to the browser as a cookie. A cookie that arrives is only
 * compared with it, never checked into this type.
 */
export const sessionToken = z.string().regex(HEX_64).brand<'BrowserSessionToken'>();

/**
 * Checks the agent's secret token: 64 lowercase hex characters. The CLI sends it with every
 * request. adapters/credentials makes it once, writes it to the workspace's credential file, and is
 * the only code that reads it back.
 */
export const agentToken = z.string().regex(HEX_64).brand<'AgentToken'>();

/**
 * Checks a port the server may listen on: a whole number from 1024 through 65535. Checked by
 * cli/serve.ts from `--port`.
 */
export const loopbackPort = z.number().int().min(1024).max(65535).brand<'LoopbackPort'>();

/**
 * Checks a path on this computer chosen at start-up: any non-empty text. cli/serve.ts checks the
 * workspace, web app and resource folders; the CLI checks the paths it renders with. A request
 * never supplies one.
 */
export const hostPath = z.string().min(1).brand<'HostPath'>();

/**
 * Checks a render job ID: 1–256 characters. Made by core/rendering/job-id.ts; checked again when
 * the render worker receives the job.
 */
export const renderJobId = z.string().min(1).max(256).brand<'RenderJobId'>();

/** A generation that passed {@link generation}. */
export type Generation = z.infer<typeof generation>;

/** A browser session secret that passed {@link sessionToken}. */
export type SessionToken = z.infer<typeof sessionToken>;

/** An agent token that passed {@link agentToken}. */
export type AgentToken = z.infer<typeof agentToken>;

/** A port that passed {@link loopbackPort}. */
export type LoopbackPort = z.infer<typeof loopbackPort>;

/** A host path that passed {@link hostPath}. */
export type HostPath = z.infer<typeof hostPath>;

/** A render job ID that passed {@link renderJobId}. */
export type RenderJobId = z.infer<typeof renderJobId>;

/** A digest as Model writes it: `sha256:` and then the bare digest. */
export type PrefixedDigest = `sha256:${string}`;

/**
 * The prefix Model's digests have and the bare digests of Assets, Templates and Authoring don't.
 */
const DIGEST_PREFIX = 'sha256:';

/** Adds `sha256:` to a bare digest, as Model writes it. The one place the prefix is added. */
export function addDigestPrefix(
  bare: AssetDigest | PresetDigest | AuthoringDigest,
): PrefixedDigest {
  return `${DIGEST_PREFIX}${bare}`;
}

/** Whether the text starts with `sha256:`, as Model's digests do. */
export function hasDigestPrefix(text: string): text is PrefixedDigest {
  return text.startsWith(DIGEST_PREFIX);
}

/**
 * Removes the first 7 characters (`sha256:`) from a digest Model wrote. The one place the prefix is
 * removed. It checks nothing, so it answers plain text: the caller checks it with the owning
 * capability's digest check, which refuses text that had no prefix.
 */
export function removeDigestPrefix(prefixed: string): string {
  return prefixed.slice(DIGEST_PREFIX.length);
}
