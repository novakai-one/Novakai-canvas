/*
 * Why this file exists
 *
 * Some changes need work done before Authoring sees them. A source that names `./assets/logo.png`
 * needs the logo's bytes stored in the service first, and the change must then point at those
 * stored bytes by digest. Saving a theme or recipe for reuse needs similar preparation.
 *
 * This file names those steps. None of them saves a change: bytes stored by a command that then
 * fails are simply left unused. `adapters/service-http/resources.ts` makes the calls.
 */
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';
import type {
  Admission,
  ExpansionRequest,
  AuthoringRequest,
  StageInput,
} from '../records/foreign.js';
import type { ByteBackup } from '../records/retained-request.js';
import type { NamedAssetDigest } from '../records/staged-resource.js';
import type { PresetPreparation } from '../records/service-answers.js';

/**
 * The font, image, theme and recipe steps the service runs for the CLI. Each fails with
 * `connection-uncertain`, `invalid-response` (the answer isn't the expected shape) or
 * `service-rejected` (the service said no). None is retried.
 */
export interface ServiceResources {
  /** Stores a file's bytes in the service ("stages" them), and gives back their digest. */
  stage(input: StageInput): Promise<Result<AssetDigest>>;
  /** Reads back the exact bytes the service holds for `digest`, so a retry can put them back. */
  blob(digest: AssetDigest): Promise<Result<ByteBackup>>;
  /**
   * Has the service write the stored bytes' digests into `request` ("freeze" them), and gives back
   * the new request. An answer that fails Authoring's request check is `invalid-input`.
   */
  freeze(
    request: AuthoringRequest,
    assets: readonly NamedAssetDigest[],
  ): Promise<Result<AuthoringRequest>>;
  /** Stores a kept copy of bytes again, so a retried request finds them. */
  restore(backup: ByteBackup): Promise<Result<void>>;
  /**
   * Asks the service to work out exactly what saving `admission` (a theme or recipe, with its
   * stored fonts and images) will store, without saving it. Gives back the key it will be saved
   * under, and the whole answer for the save request.
   */
  prepare(
    admission: Admission,
    assets: readonly NamedAssetDigest[],
  ): Promise<Result<PresetPreparation>>;
  /**
   * Copies a saved recipe out as source text to edit, as a new collection whose ID is
   * `--namespace`. Saves nothing.
   */
  instantiate(expansion: ExpansionRequest): Promise<Result<string>>;
}
