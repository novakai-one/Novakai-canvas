/*
 * render:png's own faults: what the render finds wrong itself, and the `provider-failed` fault a
 * native throw becomes (a filesystem, temp-directory or wasm step, or an owner that threw
 * unexpectedly), with the native evidence kept. Data only; `faulted` and `nativeFault` in
 * errors.ts build the failed Results. The caller corrects the named input or resource and runs
 * render:png again.
 */
import type { ThemeChoice } from './render.js';
import type { AssetId, CollectionName, FilePath } from '../brands.js';

/**
 * A render failure the CLI found itself. Consumers branch on the code, never the message.
 * - `missing-theme`: the theme override has no admitted pin.
 * - `collection-selection`: a collection name matched no recipe and not exactly one shipped
 *   collection; `matches` counts the shipped matches.
 * - `collection-required`: a theme override was asked for a source that is not a collection.
 * - `collection-title-required`: a theme override was asked for a collection without a title.
 * - `invalid-asset-pin`: a collection asset's digest is not Model's `sha256:` pin. Model
 *   validation refuses such a collection first, so no unchecked digest reaches Assets.
 * - `duplicate-asset`: the source declares one asset ID twice; the pins it is lowered against hold
 *   one record per ID.
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
      readonly asset: AssetId;
      /** The digest text as the collection gives it. */
      readonly digest: string;
    }
  | {
      readonly code: 'duplicate-asset';
      readonly asset: AssetId;
    }
  | ProviderFault;

/** The one fault a native filesystem, temp-directory or wasm step fails with. */
export interface ProviderFault {
  readonly code: 'provider-failed';
  /** The native error's message. Human context only. */
  readonly message: string;
  readonly detail: NativeDetail;
}

/** A native error's failing path, raw OS code (e.g. `ENOENT`) and syscall (e.g. `open`), when given. */
export interface NativeDetail {
  readonly path?: FilePath;
  readonly systemCode?: string;
  readonly syscall?: string;
}
