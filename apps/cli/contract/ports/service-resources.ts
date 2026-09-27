/*
 * The service's Assets and Templates steps a command runs before its Authoring request: stage
 * bytes, back them up, freeze aliases, restore backups, prepare a preset, expand a recipe.
 * Declaration only; adapters/service-http/resources.ts implements it over the HTTP transport.
 * Nothing here commits: staged bytes left by a failed command are collectable Assets orphans.
 */
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';
import type { Admission, ExpansionRequest, Request, StageInput } from '../records/foreign.js';
import type { ByteBackup } from '../records/retained-request.js';
import type { AssetBinding } from '../records/staged-resource.js';
import type { PresetPreparation } from '../records/service-answers.js';

/**
 * One resource call; nothing is retried. Every method fails with `connection-uncertain`,
 * `invalid-response` (the answer is not a service envelope, or does not match the checked shape)
 * or `service-rejected` (the service's own failure record, kept whole).
 */
export interface ServiceResources {
  /** Stages local bytes with Assets; the digest of the normalised bytes. */
  stage(input: StageInput): Promise<Result<AssetDigest>>;
  /** The exact normalised bytes Assets holds for `digest`, kept for replay. */
  blob(digest: AssetDigest): Promise<Result<ByteBackup>>;
  /**
   * `request` with `assets` frozen into it by the service. An answer that fails Authoring's
   * request schema is `invalid-input`.
   */
  freeze(
    request: Request,
    assets: readonly AssetBinding[],
  ): Promise<Result<Request>>;
  /** Restages one byte backup, so a replayed request finds its bytes. */
  restore(backup: ByteBackup): Promise<Result<void>>;
  /** Templates' preparation of one preset admission over its staged assets. */
  prepare(
    admission: Admission,
    assets: readonly AssetBinding[],
  ): Promise<Result<PresetPreparation>>;
  /** A pinned recipe expanded under a namespace, as editable DSL. Nothing is written. */
  instantiate(expansion: ExpansionRequest): Promise<Result<string>>;
}
