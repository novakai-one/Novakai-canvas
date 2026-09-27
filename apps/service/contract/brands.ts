/*
 * The service's typed identities. The capability brands the service reads are re-exported as
 * types (their schemas are in schemas.ts); the brands only the service mints are declared here,
 * each with the one boundary that mints or parses it. Also the one conversion between Model's
 * pinned digest text and the bare digests Assets, Templates and Authoring check. Pure. Text a
 * schema rejects is its boundary's refusal to report.
 */
import { z } from 'zod';
import type { collectionId } from '@novakai/canvas-model';
import type { Digest as AssetDigest } from '@novakai/canvas-assets';
import type { Digest as PresetDigest } from '@novakai/canvas-templates';
import type { Digest as AuthoringDigest } from '@novakai/canvas-authoring';

export type { WorkspaceId, PlannerId, ActorId, Timestamp } from '@novakai/canvas-authoring';
export type { AssetDigest, AuthoringDigest };

/** 64 lowercase hex characters: the grammar of both service secrets. */
const HEX_64 = /^[a-f0-9]{64}$/;

/** A Model collection ID. Model exports the schema, not the type, so the type is derived here. */
export type CollectionId = z.infer<typeof collectionId>;

/**
 * Checks a transport generation: 1–128 characters. Minted by adapters/credentials when the server
 * starts; parsed from the mutation and response envelopes.
 */
export const generation = z.string().min(1).max(128).brand<'TransportGeneration'>();

/**
 * Checks the browser session secret: 64 lowercase hex characters. Minted by adapters/credentials
 * when the server starts. Cookie text is only compared with it, never branded.
 */
export const sessionToken = z.string().regex(HEX_64).brand<'BrowserSessionToken'>();

/**
 * Checks the agent credential: 64 lowercase hex characters. Minted into the credential file and
 * parsed back from it by adapters/credentials only.
 */
export const agentToken = z.string().regex(HEX_64).brand<'AgentToken'>();

/**
 * Checks a port the server may listen on: a whole number from 1024 through 65535. Parsed by
 * cli/serve.ts.
 */
export const loopbackPort = z.number().int().min(1024).max(65535).brand<'LoopbackPort'>();

/**
 * Checks a host filesystem path chosen at startup: any non-empty text. Parsed by cli/serve.ts and
 * by the CLI for its installation and wasm paths. compose/producer.ts derives the libavoid wasm
 * path from the resource root; the render worker re-parses it from the job envelope. A request
 * never supplies one.
 */
export const hostPath = z.string().min(1).brand<'HostPath'>();

/**
 * Checks a render job ID: 1–256 characters. Minted by core/rendering/job-id.ts; parsed from the
 * worker's job envelope.
 */
export const renderJobId = z.string().min(1).max(256).brand<'RenderJobId'>();

/** A generation that passed {@link generation}. */
export type Generation = z.infer<typeof generation>;

/** A browser session secret that passed {@link sessionToken}. */
export type SessionToken = z.infer<typeof sessionToken>;

/** An agent credential that passed {@link agentToken}. */
export type AgentToken = z.infer<typeof agentToken>;

/** A port that passed {@link loopbackPort}. */
export type LoopbackPort = z.infer<typeof loopbackPort>;

/** A host path that passed {@link hostPath}. */
export type HostPath = z.infer<typeof hostPath>;

/** A render job ID that passed {@link renderJobId}. */
export type RenderJobId = z.infer<typeof renderJobId>;

/** Model's pinned digest text: `sha256:` then the bare digest. */
export type PinnedDigest = `sha256:${string}`;

/** The prefix Model's digests carry and the bare digests of Assets, Templates and Authoring lack. */
const PIN_PREFIX = 'sha256:';

/** Model's pinned form of a bare digest. The one place the prefix is added. Never fails. */
export function pinnedDigest(bare: AssetDigest | PresetDigest | AuthoringDigest): PinnedDigest {
  return `${PIN_PREFIX}${bare}`;
}

/** Whether text is in Model's pinned form (starts with `sha256:`). Never fails. */
export function isPinnedDigest(text: string): text is PinnedDigest {
  return text.startsWith(PIN_PREFIX);
}

/**
 * The bare digest of Model's pinned digest text: the first 7 characters (`sha256:`) removed. The
 * one place the prefix is removed. Never fails; the caller parses the result with its owner's
 * digest schema, which refuses text that was not pinned.
 */
export function bareDigest(pinned: string): string {
  return pinned.slice(PIN_PREFIX.length);
}
