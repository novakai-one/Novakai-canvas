/*
 * render:png's failure contract: the faults the render finds itself, the evidence a failure can
 * carry and the `render-failed` record printed as JSON. Data only; `faulted` and `nativeFault` in
 * errors.ts build the failed Results. The caller corrects the named input or resource and runs
 * render:png again.
 */
import type { CliFailure } from '../errors.js';
import type { Collection, FailureSource } from './foreign.js';
import type { ProviderFault } from './provider-fault.js';
import type { ThemeChoice } from './render.js';
import type { CollectionName } from '../brands.js';

/**
 * A render failure the CLI found itself. Consumers branch on the code, never the message.
 * - `missing-theme`: the theme override has no admitted pin.
 * - `collection-selection`: a collection name matched no recipe and not exactly one shipped
 *   collection; `matches` counts the shipped matches.
 * - `collection-required`: a theme override was asked for a source that is not a collection.
 * - `collection-title-required`: a theme override was asked for a collection without a title.
 * - `invalid-asset-pin`: a collection asset's digest is not Model's `sha256:` pin. Model
 *   validation refuses such a collection first, so no unchecked digest reaches Assets.
 * - `provider-failed`: a filesystem, temp-directory or wasm step threw, or an owner threw
 *   unexpectedly; the native evidence is kept.
 */
export type RenderFault =
  | {
      readonly code: 'missing-theme';
      readonly theme: ThemeChoice;
    }
  | {
      readonly code: 'collection-selection';
      readonly id: CollectionName;
      readonly matches: number;
    }
  | { readonly code: 'collection-required' }
  | { readonly code: 'collection-title-required' }
  | {
      readonly code: 'invalid-asset-pin';
      readonly asset: Collection['assets'][number]['id'];
      /** The digest text as the collection gives it. */
      readonly digest: string;
    }
  | ProviderFault;

/**
 * What a failed render carries: the CLI's own fault, a CLI failure (theme grammar, resource
 * reads), or Language, Model, Assets, Templates, service or Export evidence kept whole.
 */
export type RenderEvidence = RenderFault | CliFailure | FailureSource;

/** The failure render:png prints. Stored collections are never changed by a render. */
export interface RenderFailure {
  readonly code: 'render-failed';
  readonly message: string;
  readonly recovery: string;
  readonly source: RenderEvidence;
}
