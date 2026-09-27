/*
 * Resource and preset records of the service commands: the retained byte backup, the resource
 * reader and the preset inputs. Declarations only; the adapters implement both ports, and every
 * method returns its failure as a value.
 */
import { z } from 'zod';
import type { Request, Snapshot } from '@novakai/canvas-authoring';
import type { Command } from './command.js';
import type { ResourceRequest } from '@novakai/canvas-language';
export type { ResourceRequest } from '@novakai/canvas-language';
import type { Result } from '../errors.js';
import { assetDigest, type AssetDigest, type FilePath } from '../brands.js';
/** Normalized byte copies belong to local retry retention, never canonical workspace records. */
export const byteBackup = z.strictObject({ digest: assetDigest, base64: z.string() });
export type ByteBackup = z.infer<typeof byteBackup>;
/** Filesystem reads are confined to the directory of `file`, the DSL or theme source that declares them. */
export interface ResourceFiles {
  read(
    file: FilePath,
    request: ResourceRequest,
  ): Promise<Result<LocalInput>>;
}
/** One declared resource: a pinned digest (`stage` null) or local bytes to stage (`digest` null). */
export interface LocalInput {
  readonly alias: string;
  readonly digest: AssetDigest | null;
  readonly stage: unknown;
}
/** Preset inputs use semantic sources and exact owner-prepared identities, never JSON coordinates. */
export interface PresetInputs {
  source(
    command: Command,
    source: string,
  ): Result<{ readonly admission: unknown; readonly resources: readonly ResourceRequest[] }>;
  request(
    input: unknown,
    snapshot: Snapshot,
    id: string,
    assets: readonly { readonly alias: string; readonly digest: AssetDigest }[],
  ): Result<Request>;
  expansion(
    pin: string,
    namespace: string,
  ): Result<unknown>;
}
export interface ResourceSyntax {
  requests(source: string): Result<readonly ResourceRequest[]>;
}
